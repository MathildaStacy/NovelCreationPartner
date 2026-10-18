package com.novelcreationpartner.files

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.novelcreationpartner.transport.NativeCoverStoreSpec
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/** System selection only. No path or external URI supplied by JavaScript is ever opened. */
class CoverStoreModule(context: ReactApplicationContext) : NativeCoverStoreSpec(context) {
  companion object { const val NAME = "CoverStore"; const val REQUEST = 8722; const val LIMIT = 30 * 1024 * 1024 }
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var stopped = false
  @Volatile private var picking: Promise? = null
  private fun root() = File(reactApplicationContext.filesDir, "covers").apply { if (!exists() && !mkdirs()) throw IOException("Cannot create private covers") }
  private fun file(token: String): File {
    require(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").matches(token))
    return File(root(), "$token.jpg")
  }
  private fun dispatch(promise: Promise, action: () -> Unit) {
    try { executor.execute { if (stopped) { promise.reject("COVER_UNAVAILABLE", "Image operation stopped"); return@execute }; try { action() }
      catch (error: Exception) { val code = when { error.message == "large" -> "COVER_LARGE"; error is IOException && error.message?.contains("ENOSPC") == true -> "STORAGE_FULL"; else -> "COVER_FORMAT" }; promise.reject(code, "Could not process selected image") } } }
    catch (_: Exception) { promise.reject("COVER_UNAVAILABLE", "Image operation stopped") }
  }
  private fun normalize(bytes: ByteArray): String {
    if (bytes.size > LIMIT) throw IllegalArgumentException("large")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > 2400) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: throw IllegalArgumentException()
    var bitmap = decoded
    try {
      val orientation = try { ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
      val matrix = Matrix()
      when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      }
      if (!matrix.isIdentity) { bitmap = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true); if (bitmap !== decoded) decoded.recycle() }
      val ratio = 1200.0 / max(bitmap.width, bitmap.height)
      if (ratio < 1) {
        val scaled = Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * ratio).roundToInt()), max(1, (bitmap.height * ratio).roundToInt()), true)
        if (scaled !== bitmap) bitmap.recycle(); bitmap = scaled
      }
      val token = UUID.randomUUID().toString()
      val target = file(token); val temporary = File(root(), "$token.tmp")
      try {
        FileOutputStream(temporary).use { output -> if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)) throw IOException("Image encoding failed"); output.fd.sync() }
        if (stopped || !temporary.renameTo(target)) throw IOException("Image write stopped")
        return JSONObject().put("token", token).put("uri", android.net.Uri.fromFile(target).toString()).toString()
      } catch (error: Exception) { temporary.delete(); target.delete(); throw error }
    } finally { if (!bitmap.isRecycled) bitmap.recycle(); if (!decoded.isRecycled) decoded.recycle() }
  }
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST) return
      val promise = picking ?: return
      if (resultCode != Activity.RESULT_OK) { picking = null; promise.resolve(null); return }
      val uri = data?.data
      if (uri?.scheme != "content") { picking = null; promise.reject("COVER_FORMAT", "No selected image"); return }
      dispatch(promise) {
        try {
          val resolver = reactApplicationContext.contentResolver
          resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0) > LIMIT) throw IllegalArgumentException("large") }
          val output = ByteArrayOutputStream()
          resolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(16384)
            while (true) { val count = input.read(buffer); if (count < 0) break; if (output.size() + count > LIMIT) throw IllegalArgumentException("large"); output.write(buffer, 0, count) }
          } ?: throw IllegalArgumentException()
          promise.resolve(normalize(output.toByteArray()))
        } finally { picking = null }
      }
    }
  }
  init { context.addActivityEventListener(listener) }
  override fun getName() = NAME
  override fun pick(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity
      if (stopped || activity == null) { promise.reject("COVER_UNAVAILABLE", "No foreground activity"); return@runOnUiThread }
      if (picking != null) { promise.reject("COVER_BUSY", "Image picker is already open"); return@runOnUiThread }
      picking = promise
      try { activity.startActivityForResult(ActivityResultContracts.PickVisualMedia().createIntent(reactApplicationContext, PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)), REQUEST) }
      catch (_: Exception) { picking = null; promise.reject("COVER_UNAVAILABLE", "Could not open photo picker") }
    }
  }
  override fun importImage(base64: String, promise: Promise) = dispatch(promise) {
    if (base64.length > ((LIMIT + 2L) / 3 * 4)) throw IllegalArgumentException("large")
    require(base64.length % 4 == 0 && Regex("[A-Za-z0-9+/]*={0,2}").matches(base64))
    promise.resolve(normalize(Base64.decode(base64, Base64.NO_WRAP)))
  }
  override fun read(token: String, promise: Promise) = dispatch(promise) {
    val source = file(token); if (source.length() > LIMIT) throw IllegalArgumentException("large")
    promise.resolve(JSONObject().put("base64", Base64.encodeToString(source.readBytes(), Base64.NO_WRAP)).put("mimeType", "image/jpeg").toString())
  }
  override fun remove(token: String, promise: Promise) = dispatch(promise) { val target = file(token); if (target.exists() && !target.delete()) throw IOException("Cannot delete private cover"); promise.resolve(null) }
  override fun prune(keepTokensJson: String, promise: Promise) = dispatch(promise) {
    val keep = JSONArray(keepTokensJson); val names = (0 until keep.length()).map { "${keep.getString(it)}.jpg" }.toSet()
    root().listFiles()?.filter { it.name !in names && System.currentTimeMillis() - it.lastModified() > 86400000L }?.forEach { if (it.isFile) it.delete() }
    promise.resolve(null)
  }
  override fun invalidate() { stopped = true; reactApplicationContext.removeActivityEventListener(listener); UiThreadUtil.runOnUiThread { picking?.resolve(null); picking = null }; executor.shutdown(); super.invalidate() }
}
