package com.veil.vpn

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter plugin bridging Dart <-> [VeilVpnService] (which owns the
 * wireguard-android GoBackend).
 *
 * MethodChannel "veil_vpn/tunnel":
 *   prepare    -> Bool   true = system VPN consent UI was shown; the result
 *                        arrives later via the "onVpnConsentResult" callback.
 *   connect    {config: String (wg-quick), excludedApps: List<String>}
 *   disconnect ->
 *   getStats   -> {rxBytes, txBytes, latestHandshakeAt}
 *
 * EventChannel "veil_vpn/tunnel_status":
 *   {state: connecting|connected|disconnecting|disconnected|error,
 *    message: String?}
 *
 * MethodChannel "veil_vpn/system":
 *   openVpnSettings -> opens the OS VPN settings screen (kill-switch primer:
 *                        Always-on VPN + "Block connections without VPN").
 */
class VeilVpnPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware {

    private lateinit var tunnelChannel: MethodChannel
    private lateinit var systemChannel: MethodChannel
    private var eventChannel: EventChannel? = null
    private var appContext: Context? = null
    private var activity: Activity? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        const val REQUEST_VPN_CONSENT = 0x5E11

        /** Set by [VeilVpnService]; called on a background thread. */
        @Volatile
        var statusSink: EventChannel.EventSink? = null
        private var mainHandlerRef: Handler? = null

        fun emitStatus(state: String, message: String?) {
            val sink = statusSink ?: return
            val payload = mapOf("state" to state, "message" to message)
            val h = mainHandlerRef
            if (h != null) {
                h.post { sink.success(payload) }
            } else {
                sink.success(payload)
            }
        }
    }

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        appContext = binding.applicationContext
        mainHandlerRef = mainHandler
        tunnelChannel = MethodChannel(binding.binaryMessenger, "veil_vpn/tunnel")
        tunnelChannel.setMethodCallHandler(this)
        systemChannel = MethodChannel(binding.binaryMessenger, "veil_vpn/system")
        systemChannel.setMethodCallHandler(this)
        eventChannel = EventChannel(binding.binaryMessenger, "veil_vpn/tunnel_status")
        eventChannel!!.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                statusSink = events
            }

            override fun onCancel(arguments: Any?) {
                statusSink = null
            }
        })
        VeilVpnService.statusListener = { state, message -> emitStatus(state, message) }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        tunnelChannel.setMethodCallHandler(null)
        systemChannel.setMethodCallHandler(null)
        eventChannel?.setStreamHandler(null)
        statusSink = null
        VeilVpnService.statusListener = null
    }

    // ---- ActivityAware ----

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    fun onActivityResult(requestCode: Int, resultCode: Int) {
        if (requestCode == REQUEST_VPN_CONSENT) {
            val granted = resultCode == Activity.RESULT_OK
            tunnelChannel.invokeMethod(
                "onVpnConsentResult",
                mapOf("granted" to granted),
            )
        }
    }

    // ---- Method calls ----

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepare" -> {
                val ctx = appContext
                val act = activity
                if (ctx == null || act == null) {
                    result.error("no_activity", "No activity to show VPN consent.", null)
                    return
                }
                val prepareIntent = VpnService.prepare(ctx)
                if (prepareIntent != null) {
                    act.startActivityForResult(prepareIntent, REQUEST_VPN_CONSENT)
                    result.success(true) // consent UI shown; result via callback
                } else {
                    result.success(false) // already authorized
                }
            }

            "connect" -> {
                val ctx = appContext
                if (ctx == null) {
                    result.error("no_context", "Plugin not attached.", null)
                    return
                }
                val config = call.argument<String>("config")
                if (config.isNullOrBlank()) {
                    result.error("bad_config", "Missing WireGuard config.", null)
                    return
                }
                @Suppress("UNCHECKED_CAST")
                val excludedApps =
                    (call.argument<List<String>>("excludedApps") ?: emptyList())
                val intent = Intent(ctx, VeilVpnService::class.java).apply {
                    action = VeilVpnService.ACTION_START
                    putExtra(VeilVpnService.EXTRA_CONFIG, config)
                    putStringArrayListExtra(
                        VeilVpnService.EXTRA_EXCLUDED_APPS,
                        ArrayList(excludedApps),
                    )
                }
                ContextCompat.startForegroundService(ctx, intent)
                result.success(null)
            }

            "disconnect" -> {
                val ctx = appContext
                if (ctx == null) {
                    result.error("no_context", "Plugin not attached.", null)
                    return
                }
                val intent = Intent(ctx, VeilVpnService::class.java).apply {
                    action = VeilVpnService.ACTION_STOP
                }
                ctx.startService(intent)
                result.success(null)
            }

            "getStats" -> {
                val stats = VeilVpnService.lastStats
                result.success(
                    mapOf(
                        "rxBytes" to (stats?.get("rxBytes") ?: 0L),
                        "txBytes" to (stats?.get("txBytes") ?: 0L),
                        "latestHandshakeAt" to stats?.get("latestHandshakeAt"),
                    ),
                )
            }

            "openVpnSettings" -> {
                val act = activity ?: appContext
                if (act == null) {
                    result.error("no_activity", "No activity available.", null)
                    return
                }
                val intent = Intent(Settings.ACTION_VPN_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                act.startActivity(intent)
                result.success(null)
            }

            else -> result.notImplemented()
        }
    }
}
