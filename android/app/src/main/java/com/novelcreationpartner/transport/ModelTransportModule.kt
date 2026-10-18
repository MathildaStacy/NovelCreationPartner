package com.novelcreationpartner.transport

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Dedicated client: never inherits RN interceptors, cookies, cache or redirect policy. */
class ModelTransportModule(context: ReactApplicationContext) : NativeModelTransportSpec(context) {
  companion object { const val NAME = "ModelTransport" }
  private val calls = ConcurrentHashMap<String, Call>()
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES).cache(null)
    .connectTimeout(60, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
    .callTimeout(5, TimeUnit.MINUTES).build()

  override fun getName() = NAME

  private fun event(id: String, kind: String, status: Int = 0, headers: String = "{}", data: String = "", code: String = "") {
    val map = Arguments.createMap()
    map.putString("requestId", id); map.putString("kind", kind)
    map.putDouble("status", status.toDouble()); map.putString("headers", headers)
    map.putString("data", data); map.putString("code", code)
    emitOnEvent(map)
  }

  private fun finish(id: String, call: Call, kind: String, code: String = "") {
    if (calls.remove(id, call)) event(id, kind, code = code)
  }

  override fun start(requestId: String, url: String, method: String, headers: String, body: String) {
    try {
      // The URL is validated by features before any Key is read. Platform cleartext
      // policy remains enabled; this module never bypasses TLS/ATS or logs failures.
      require(method == "GET" || method == "POST")
      val builder = Request.Builder().url(url)
      require(builder.build().url.scheme in listOf("https", "http"))
      val fields = JSONObject(headers)
      val allowed = setOf("authorization", "x-api-key", "anthropic-version", "content-type", "accept")
      fields.keys().forEach { name ->
        require(name.lowercase() in allowed)
        builder.header(name, fields.getString(name))
      }
      builder.header("Cache-Control", "no-store")
      if (method == "POST") builder.post(body.toRequestBody("application/json".toMediaType()))
      val call = client.newCall(builder.build())
      if (calls.putIfAbsent(requestId, call) != null) return
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          finish(requestId, call, "error", "network")
        }
        override fun onResponse(call: Call, response: Response) {
          response.use {
            if (calls[requestId] !== call) return
            if (response.code in 300..399) {
              finish(requestId, call, "error", "redirect")
              return
            }
            val safe = JSONObject()
            listOf("content-type", "retry-after", "retry-after-ms", "x-should-retry").forEach { name ->
              response.header(name)?.let { safe.put(name, it) }
            }
            event(requestId, "headers", response.code, safe.toString())
            try {
              val input = response.body?.byteStream() ?: throw IOException()
              val buffer = ByteArray(8192)
              var total = 0L
              while (calls[requestId] === call) {
                val count = input.read(buffer)
                if (count == -1) break
                total += count
                if (total > 16L * 1024 * 1024) {
                  finish(requestId, call, "error", "too_large")
                  call.cancel()
                  return
                }
                event(requestId, "data", data = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP))
              }
              finish(requestId, call, "complete")
            } catch (_: IOException) {
              finish(requestId, call, "error", "network")
            }
          }
        }
      })
    } catch (_: Exception) {
      event(requestId, "error", code = "network")
    }
  }

  override fun abort(requestId: String) {
    calls.remove(requestId)?.let { it.cancel(); event(requestId, "cancelled") }
  }

  override fun invalidate() {
    calls.values.forEach { it.cancel() }
    calls.clear()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
    super.invalidate()
  }
}
