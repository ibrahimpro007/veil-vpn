package com.veil.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.io.ByteArrayInputStream

/**
 * Foreground service owning the wireguard-android [GoBackend].
 *
 * Why a separate foreground service: the tunnel library's own
 * `GoBackend$VpnService` (declared in the manifest, started internally by
 * [GoBackend]) does not promote itself to foreground. This service keeps the
 * process in the foreground with a persistent notification while the tunnel
 * is up, so the OS does not kill the VPN.
 *
 * Split tunneling: package names are injected as `ExcludedApplications`
 * into the `[Interface]` section before parsing; GoBackend translates them
 * to `VpnService.Builder.addDisallowedApplication(...)`.
 *
 * Kill-switch semantics while connected come from the backend itself:
 * GoBackend builds the tun with `setBlocking(true)` and only calls
 * `allowFamily(AF_INET/AF_INET6)` when there is NO default route — with our
 * `0.0.0.0/0` + `::/0` AllowedIPs every packet must traverse the tunnel.
 * The user-facing "always-on + block connections without VPN" toggle lives
 * in system settings (see `openVpnSettings`); non-device-owner apps cannot
 * flip it programmatically.
 */
class VeilVpnService : Service() {

    companion object {
        const val ACTION_START = "com.veil.vpn.action.START"
        const val ACTION_STOP = "com.veil.vpn.action.STOP"
        const val EXTRA_CONFIG = "config"
        const val EXTRA_EXCLUDED_APPS = "excluded_apps"

        private const val TAG = "VeilVpnService"
        private const val NOTIF_ID = 1001
        private const val CHANNEL_ID = "veil_vpn_tunnel"

        /** Called on a background thread; the plugin marshals to main. */
        var statusListener: ((state: String, message: String?) -> Unit)? = null

        @Volatile
        var lastStats: Map<String, Long>? = null
    }

    private var backend: GoBackend? = null
    private var running = false

    private val tunnel = object : Tunnel {
        override fun getName(): String = "VeilVPN"

        override fun onStateChange(newState: Tunnel.State) {
            // Invoked by GoBackend when the OS tears the VpnService down
            // (e.g. user revoked VPN permission, always-on replaced us).
            if (newState == Tunnel.State.DOWN && running) {
                running = false
                statusListener?.invoke("disconnected", "VPN was stopped by the system.")
                stopSelf()
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent.getStringExtra(EXTRA_CONFIG).orEmpty()
                val excluded =
                    intent.getStringArrayListExtra(EXTRA_EXCLUDED_APPS)
                        ?: arrayListOf()
                handleStart(config, excluded.toList())
            }
            ACTION_STOP -> handleStop(userInitiated = true)
        }
        return START_STICKY
    }

    private fun handleStart(configText: String, excludedApps: List<String>) {
        if (running) {
            Log.i(TAG, "Tunnel already running; ignoring duplicate start.")
            return
        }
        startForegroundWithNotification("Connecting…")
        statusListener?.invoke("connecting", null)

        Thread {
            try {
                val withExclusions = injectExcludedApps(configText, excludedApps)
                val config =
                    Config.parse(ByteArrayInputStream(withExclusions.toByteArray()))
                val be = GoBackend(this)
                backend = be
                be.setState(tunnel, Tunnel.State.UP, config)
                running = true
                refreshStats()
                startForegroundWithNotification("Connected")
                statusListener?.invoke("connected", null)
                Log.i(TAG, "Tunnel is up.")
            } catch (e: BackendException) {
                Log.e(TAG, "Backend error: ${e.reason}", e)
                statusListener?.invoke("error", friendlyBackendError(e))
                stopSelf()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start tunnel", e)
                statusListener?.invoke(
                    "error",
                    e.message ?: "Could not start the VPN tunnel.",
                )
                stopSelf()
            }
        }.start()
    }

    private fun handleStop(userInitiated: Boolean) {
        if (!running && backend == null) {
            stopSelf()
            return
        }
        statusListener?.invoke("disconnecting", null)
        Thread {
            try {
                backend?.setState(tunnel, Tunnel.State.DOWN, null)
            } catch (e: Exception) {
                Log.w(TAG, "Error while bringing tunnel down", e)
            } finally {
                backend = null
                running = false
                lastStats = null
                if (userInitiated) {
                    statusListener?.invoke("disconnected", null)
                }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }.start()
    }

    override fun onDestroy() {
        try {
            if (running) {
                backend?.setState(tunnel, Tunnel.State.DOWN, null)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error in onDestroy", e)
        } finally {
            backend = null
            running = false
        }
        super.onDestroy()
    }

    /** Reads live counters from wireguard-go (rx/tx bytes, last handshake). */
    private fun refreshStats() {
        try {
            val stats = backend?.getStatistics(tunnel) ?: return
            var handshakeMs = 0L
            for (peer in stats.peers()) {
                val ps = stats.peer(peer) ?: continue
                if (ps.latestHandshakeEpochMillis > handshakeMs) {
                    handshakeMs = ps.latestHandshakeEpochMillis
                }
            }
            lastStats = mapOf(
                "rxBytes" to stats.totalRx(),
                "txBytes" to stats.totalTx(),
                "latestHandshakeAt" to if (handshakeMs > 0) handshakeMs / 1000 else 0L,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not read statistics", e)
        }
    }

    /** Inserts `ExcludedApplications` into the `[Interface]` section. */
    private fun injectExcludedApps(configText: String, apps: List<String>): String {
        if (apps.isEmpty()) return configText
        val line = "ExcludedApplications = ${apps.joinToString(", ")}"
        val header = "[Interface]"
        val idx = configText.indexOf(header)
        if (idx < 0) return configText
        val eol = configText.indexOf('\n', idx)
        return if (eol < 0) {
            "$configText\n$line\n"
        } else {
            configText.substring(0, eol + 1) + line + "\n" +
                configText.substring(eol + 1)
        }
    }

    private fun friendlyBackendError(e: BackendException): String {
        return when (e.reason) {
            BackendException.Reason.VPN_NOT_AUTHORIZED ->
                "VPN permission is required. Please allow the VPN connection request."
            BackendException.Reason.DNS_RESOLUTION_FAILURE ->
                "Could not resolve the server address. Check your connection."
            BackendException.Reason.TUN_CREATION_ERROR ->
                "Could not create the VPN interface."
            BackendException.Reason.GO_ACTIVATION_ERROR_CODE ->
                "WireGuard backend failed to start " +
                    "(code ${e.format.firstOrNull() ?: "?"})."
            else -> e.localizedMessage ?: "Could not start the VPN tunnel."
        }
    }

    // ---- foreground notification ----

    private fun startForegroundWithNotification(statusText: String) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "VeilVPN tunnel",
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.description = "Shows while the VeilVPN tunnel is active."
            manager.createNotificationChannel(channel)
        }

        val stopIntent = Intent(this, VeilVpnService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = openIntent?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("VeilVPN")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Disconnect",
                stopPending,
            )
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIF_ID, notification)
        }
    }
}
