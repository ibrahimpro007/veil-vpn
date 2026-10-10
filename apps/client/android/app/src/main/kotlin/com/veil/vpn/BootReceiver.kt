package com.veil.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BOOT_COMPLETED receiver.
 *
 * Honest scope: Android 10+ background-start restrictions mean we cannot
 * silently bring the tunnel up at boot without a user-visible trigger, and
 * peer configs expire server-side anyway. So this receiver only observes the
 * `veil.launch_at_login` preference (written by the Settings screen); when
 * the user next opens the app, `connectOnLaunch`/reconnect logic offers to
 * reconnect. No silent network activity happens at boot.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "VeilVpnBoot"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = context.getSharedPreferences(
            "FlutterSharedPreferences",
            Context.MODE_PRIVATE,
        )
        val launchAtLogin = prefs.getBoolean("flutter.veil.launch_at_login", false)
        Log.i(TAG, "Boot completed; launchAtLogin=$launchAtLogin (no silent connect).")
    }
}
