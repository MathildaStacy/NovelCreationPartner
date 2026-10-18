package com.novelcreationpartner.files

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.novelcreationpartner.transport.NativeDocumentStoreSpec
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

/** Only content URIs and content bytes; never accepts a caller-supplied filesystem path. */
class DocumentStoreModule(context: ReactApplicationContext) : NativeDocumentStoreSpec(context) {
  companion object {
    const val NAME = "DocumentStore"; const val PICK_REQUEST = 8721; const val MAX_BYTES = 50 * 1024 * 1024
    // Survives React reloads, but a new app process owns a new export session.
    private val EXPORT_SESSION = UUID.randomUUID().toString()
  }
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var invalidated = false
  private var picking: Promise? = null
  @Volatile private var exporting = false
  @Volatile private var reading = false
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != PICK_REQUEST) return
      val promise = picking ?: return
      picking = null
      if (invalidated) { promise.resolve(null); return }
      if (resultCode != Activity.RESULT_OK) { promise.resolve(null); return }
      val uri = data?.data
      if (uri == null || uri.scheme != "content") { promise.reject("DOCUMENT_INVALID", "Choose a document from the system picker"); return }
      reading = true
      dispatch(promise) {
        try {
          val resolver = reactApplicationContext.contentResolver
          var name = "document"
          resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
              val size = cursor.getColumnIndex(OpenableColumns.SIZE)
              if (size >= 0 && !cursor.isNull(size) && cursor.getLong(size) > MAX_BYTES) throw IllegalArgumentException()
              val label = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
              if (label >= 0 && !cursor.isNull(label)) name = safeName(cursor.getString(label))
            }
          }
          val output = ByteArrayOutputStream()
          resolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(16384)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              if (output.size() + count > MAX_BYTES) throw IllegalArgumentException()
              output.write(buffer, 0, count)
            }
          } ?: throw IllegalArgumentException()
          if (invalidated) { promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped"); return@dispatch }
          promise.resolve(JSONObject().put("name", name).put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).toString())
        } catch (_: Exception) { promise.reject("DOCUMENT_INVALID", "Could not read document within 50 MiB limit") }
        finally { reading = false }
      }
    }
  }
  init { context.addActivityEventListener(listener) }
  private fun dispatch(promise: Promise, work: () -> Unit) {
    try { executor.execute(work) }
    catch (_: Exception) { reading = false; exporting = false; promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped") }
  }
  override fun getName() = NAME
  private fun safeName(name: String): String {
    val safe = name.map { c -> if (c.code < 32 || c.code == 127 || c in "/\\:*?\"<>|") '_' else c }.joinToString("").trimStart('.').trim().ifBlank { "document" }
    return safe.substring(0, safe.offsetByCodePoints(0, minOf(120, safe.codePointCount(0, safe.length))))
  }
  override fun pick(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity
      if (invalidated || activity == null) { promise.reject("DOCUMENT_UNAVAILABLE", "No foreground activity"); return@runOnUiThread }
      if (picking != null || exporting || reading) { promise.reject("DOCUMENT_BUSY", "A document picker is already open"); return@runOnUiThread }
      picking = promise
      try {
        activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, PICK_REQUEST)
      } catch (_: Exception) { picking = null; promise.reject("DOCUMENT_UNAVAILABLE", "Could not open document picker") }
    }
  }
  private fun validBase64(value: String): Boolean {
    if (value.length % 4 != 0) return false
    val end = value.length - (if (value.endsWith("==")) 2 else if (value.endsWith("=")) 1 else 0)
    for (i in 0 until end) { val c = value[i]; if (!(c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/')) return false }
    return true
  }
  private fun exportRoot() = File(reactApplicationContext.cacheDir, "document_exports")
  private fun createDirectory(directory: File) {
    if (directory.isDirectory) return
    try { Os.mkdir(directory.absolutePath, 448) }
    catch (error: ErrnoException) { if (!directory.isDirectory) throw error }
  }
  private fun storageFull(error: Throwable): Boolean {
    var cause: Throwable? = error
    repeat(8) {
      val current = cause ?: return false
      if (current is ErrnoException && current.errno in setOf(OsConstants.ENOSPC, OsConstants.EDQUOT)) return true
      if (current.message?.let { Regex("ENOSPC|EDQUOT|No space left on device|Disk quota exceeded", RegexOption.IGNORE_CASE).containsMatchIn(it) } == true) return true
      cause = current.cause
    }
    return false
  }
  private fun cleanPreviousExports() {
    val root = exportRoot()
    if (!root.exists()) return
    val sessions = root.listFiles() ?: throw IOException("Could not inspect export cache")
    sessions.filter { it.name != EXPORT_SESSION }.forEach { if (!it.deleteRecursively()) throw IOException("Could not clean export cache") }
  }
  override fun cleanupExports(promise: Promise) {
    if (invalidated) { promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped"); return }
    dispatch(promise) {
      try { cleanPreviousExports(); promise.resolve(null) }
      catch (_: Exception) { promise.reject("DOCUMENT_UNAVAILABLE", "Could not clean previous export files") }
    }
  }
  override fun writeAndShare(name: String, base64: String, mime: String, promise: Promise) {
    synchronized(this) {
      if (invalidated) { promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped"); return }
      if (exporting || reading || picking != null) { promise.reject("DOCUMENT_BUSY", "Another document operation is active"); return }
      exporting = true
    }
    dispatch(promise) {
      var folder: File? = null
      try {
        if (invalidated || base64.length > ((MAX_BYTES + 2L) / 3 * 4) || !validBase64(base64)) throw IllegalArgumentException()
        if (mime !in setOf("application/zip", "application/json", "text/plain", "text/markdown", "application/octet-stream")) throw IllegalArgumentException()
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        if (bytes.size > MAX_BYTES) throw IllegalArgumentException()
        val root = exportRoot()
        val session = File(root, EXPORT_SESSION)
        val currentFolder = File(session, UUID.randomUUID().toString())
        folder = currentFolder
        createDirectory(root); createDirectory(session); createDirectory(currentFolder)
        val file = File(currentFolder, safeName(name))
        file.outputStream().use { it.write(bytes) }
        val uri: Uri = FileProvider.getUriForFile(reactApplicationContext, "${reactApplicationContext.packageName}.documents", file)
        UiThreadUtil.runOnUiThread {
          val activity = reactApplicationContext.currentActivity
          if (invalidated || activity == null) { exporting = false; currentFolder.deleteRecursively(); promise.reject("DOCUMENT_UNAVAILABLE", "No foreground activity"); return@runOnUiThread }
          try {
            val send = Intent(Intent.ACTION_SEND).apply { type = mime; putExtra(Intent.EXTRA_STREAM, uri); clipData = ClipData.newRawUri(name, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            activity.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            exporting = false
            // The chooser opening is observable; a target saving or cancelling is not.
            promise.resolve("opened")
          } catch (_: Exception) { exporting = false; currentFolder.deleteRecursively(); promise.reject("DOCUMENT_UNAVAILABLE", "Could not open system share") }
        }
      } catch (error: Exception) {
        folder?.deleteRecursively(); exporting = false
        if (storageFull(error)) promise.reject("STORAGE_FULL", "Not enough storage to generate export")
        else promise.reject("DOCUMENT_INVALID", "Could not generate export within 50 MiB limit")
      }
    }
  }
  override fun invalidate() {
    invalidated = true
    reactApplicationContext.removeActivityEventListener(listener)
    UiThreadUtil.runOnUiThread { picking?.resolve(null); picking = null }
    executor.shutdown()
    super.invalidate()
  }
}
