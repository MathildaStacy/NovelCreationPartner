package com.novelcreationpartner.files

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.novelcreationpartner.BuildConfig
import com.novelcreationpartner.transport.NativeAppInfoSpec
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors

class AppInfoModule(context: ReactApplicationContext) : NativeAppInfoSpec(context) {
  private val storageExecutor = Executors.newSingleThreadExecutor()
  companion object { const val NAME = "AppInfo" }
  override fun getName() = NAME
  override fun getInfo(promise: Promise) {
    promise.resolve(JSONObject().put("version", BuildConfig.VERSION_NAME)
      .put("build", BuildConfig.VERSION_CODE.toString()).put("debug", BuildConfig.DEBUG).toString())
  }
  override fun getStorageUsage(promise: Promise) {
    try {
      storageExecutor.execute {
        try {
          val database = reactApplicationContext.getDatabasePath("novel.db")
          val dbBytes = listOf(database, File(database.path + "-wal"), File(database.path + "-shm"))
            .fold(0L) { sum, file -> Math.addExact(sum, bytes(file)) }
          val coverBytes = bytes(File(reactApplicationContext.filesDir, "covers"))
          val cacheBytes = bytes(reactApplicationContext.cacheDir)
          if (Math.addExact(Math.addExact(dbBytes, coverBytes), cacheBytes) > 9007199254740991L) throw IOException()
          promise.resolve(JSONObject().put("db", dbBytes).put("covers", coverBytes).put("cache", cacheBytes).toString())
        } catch (_: Exception) { promise.reject("STORAGE_USAGE", "Storage usage unavailable") }
      }
    } catch (_: Exception) { promise.reject("STORAGE_USAGE", "Storage usage unavailable") }
  }
  private fun bytes(file: File): Long {
    val stat = try { Os.lstat(file.path) } catch (error: ErrnoException) {
      if (error.errno == OsConstants.ENOENT) return 0L
      throw error
    }
    // lstat deliberately excludes symbolic links and does not leave the fixed private roots.
    if (OsConstants.S_ISREG(stat.st_mode)) return stat.st_size
    if (!OsConstants.S_ISDIR(stat.st_mode)) return 0L
    val children = file.listFiles() ?: throw IOException()
    return children.fold(0L) { total, child -> Math.addExact(total, bytes(child)) }
  }
  override fun invalidate() {
    storageExecutor.shutdown()
    super.invalidate()
  }
}
