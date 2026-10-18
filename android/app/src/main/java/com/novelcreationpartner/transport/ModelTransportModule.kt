package com.novelcreationpartner.transport

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Dedicated client: never inherits RN interceptors, cookies, cache or redirect policy. */
class ModelTransportModule(context: ReactApplicationContext) : NativeModelTransportSpec(context) {
  companion object { const val NAME = "ModelTransport" }
  private class Pending {
    var call: Call? = null
    var originalRetryAfter: String? = null
    var sent = false
  }
  private val calls = ConcurrentHashMap<String, Pending>()
  @Volatile private var invalidated = false
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES).cache(null)
    .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
    .addNetworkInterceptor { chain ->
      val pending = chain.request().tag(Pending::class.java) ?: throw IOException()
      // No automatic second exchange (including HTTP/2 421 recovery) may
      // resend credentials. Explicit provider retries create a new request.
      synchronized(pending) {
        if (pending.sent) throw IOException()
        pending.sent = true
      }
      val response = chain.proceed(chain.request())
      val retryAfter = response.header("Retry-After")
      // OkHttp 4.x retries 503 + Retry-After: 0 even when connection retries
      // are disabled; oversized numeric values also overflow its parser.
      // Hide this header from that policy, preserving the real value for JS.
      if (response.code == 503 && retryAfter != null) {
        pending.originalRetryAfter = retryAfter
        response.newBuilder().header("Retry-After", "1").build()
      } else response
    }
    .connectTimeout(60, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
    .callTimeout(5, TimeUnit.MINUTES).build()

  override fun getName() = NAME

  private fun event(id: String, kind: String, status: Int = 0, headers: String = "{}", data: String = "", code: String = "") {
    if (invalidated) return
    val map = Arguments.createMap()
    map.putString("requestId", id); map.putString("kind", kind)
    map.putDouble("status", status.toDouble()); map.putString("headers", headers)
    map.putString("data", data); map.putString("code", code)
    emitOnEvent(map)
  }

  private fun finish(id: String, pending: Pending, kind: String, code: String = "", cancel: Boolean = false) {
    synchronized(pending) {
      if (!calls.remove(id, pending)) return
      if (cancel) pending.call?.cancel()
      event(id, kind, code = code)
    }
  }

  private fun emitActive(id: String, pending: Pending, kind: String, status: Int = 0, headers: String = "{}", data: String = "") {
    synchronized(pending) {
      if (calls[id] === pending) event(id, kind, status, headers, data)
    }
  }

  override fun start(requestId: String, url: String, method: String, headers: String, body: String) {
    val pending = Pending()
    synchronized(calls) {
      if (invalidated || calls.putIfAbsent(requestId, pending) != null) return
    }
    try {
      // The URL is validated by features before any Key is read. Platform cleartext
      // policy remains enabled; this module never bypasses TLS/ATS or logs failures.
      require(method == "GET" || method == "POST")
      val builder = Request.Builder().url(url)
      val endpoint = builder.build().url
      require(endpoint.scheme in listOf("https", "http") && endpoint.username.isEmpty() && endpoint.password.isEmpty())
      val fields = JSONObject(headers)
      val allowed = setOf("authorization", "x-api-key", "anthropic-version", "content-type", "accept")
      fields.keys().forEach { name ->
        require(name.lowercase() in allowed)
        val value = fields.get(name)
        require(value is String)
        builder.header(name, value)
      }
      builder.header("Cache-Control", "no-store")
      builder.tag(Pending::class.java, pending)
      if (method == "POST") {
        val json = body.toRequestBody("application/json".toMediaType())
        builder.post(object : RequestBody() {
          override fun contentType() = json.contentType()
          override fun contentLength() = json.contentLength()
          override fun writeTo(sink: BufferedSink) = json.writeTo(sink)
          override fun isOneShot() = true
        })
      }
      val call = client.newCall(builder.build())
      synchronized(pending) {
        if (calls[requestId] !== pending) return
        pending.call = call
      }
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          finish(requestId, pending, "error", "network")
        }
        override fun onResponse(call: Call, response: Response) {
          response.use {
            if (calls[requestId] !== pending) return
            if (response.code in 300..399) {
              finish(requestId, pending, "error", "redirect")
              return
            }
            val safe = JSONObject()
            listOf("content-type", "retry-after", "retry-after-ms", "x-should-retry").forEach { name ->
              (if (name == "retry-after") pending.originalRetryAfter ?: response.header(name) else response.header(name))
                ?.let { safe.put(name, it) }
            }
            emitActive(requestId, pending, "headers", response.code, safe.toString())
            try {
              val input = response.body?.byteStream() ?: throw IOException()
              val buffer = ByteArray(8192)
              var total = 0L
              while (calls[requestId] === pending) {
                val count = input.read(buffer)
                if (count == -1) break
                total += count
                if (total > 16L * 1024 * 1024) {
                  finish(requestId, pending, "error", "too_large", cancel = true)
                  return
                }
                emitActive(requestId, pending, "data", data = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP))
              }
              finish(requestId, pending, "complete")
            } catch (_: IOException) {
              finish(requestId, pending, "error", "network")
            }
          }
        }
      })
    } catch (_: Exception) {
      finish(requestId, pending, "error", "network", cancel = true)
    }
  }

  override fun abort(requestId: String) {
    calls[requestId]?.let { finish(requestId, it, "cancelled", cancel = true) }
  }

  override fun invalidate() {
    val pending = synchronized(calls) {
      invalidated = true
      calls.values.toList().also { calls.clear() }
    }
    pending.forEach { synchronized(it) { it.call?.cancel() } }
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
    super.invalidate()
  }
}
