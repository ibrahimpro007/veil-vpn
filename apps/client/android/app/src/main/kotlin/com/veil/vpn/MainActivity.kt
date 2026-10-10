package com.veil.vpn

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var veilPlugin: VeilVpnPlugin? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        veilPlugin = VeilVpnPlugin()
        flutterEngine.plugins.add(veilPlugin!!)
    }

    @Deprecated("Forwarded to the plugin for the VPN consent flow")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        veilPlugin?.onActivityResult(requestCode, resultCode)
    }
}
