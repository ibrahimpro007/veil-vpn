import type { Metadata } from "next";
import { GuideShell, type GuideStepData } from "@/components/GuideShell";
import { RELEASE_ASSETS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Android setup guide",
  description:
    "Step-by-step: install the VeilVPN APK on Android, allow unknown sources, approve the VPN permission, log in, and connect.",
};

const STEPS: GuideStepData[] = [
  {
    title: "Download the APK",
    body: (
      <p>
        On your Android phone, tap the download button above (or on the{" "}
        <a href="/download" className="text-emerald-300 hover:underline">
          download page
        </a>
        ) to get <code>{RELEASE_ASSETS.androidApk}</code>. Your browser will
        warn that &quot;this type of file can harm your device&quot; —
        that&apos;s Android&apos;s standard warning for any APK downloaded
        outside the Play Store.
      </p>
    ),
  },
  {
    title: "Allow installing from your browser",
    body: (
      <>
        <p>
          When you open the APK, Android asks you to allow installs from the app
          you downloaded it with:
        </p>
        <ul>
          <li>
            Tap <strong>Settings</strong> on the &quot;Install unknown
            apps&quot; prompt.
          </li>
          <li>
            Toggle <strong>Allow from this source</strong> on for your browser
            (e.g. Chrome).
          </li>
          <li>
            Go back and tap <strong>Install</strong>.
          </li>
        </ul>
      </>
    ),
    warning: (
      <>
        Only enable this for the browser you downloaded our APK with, and only
        after verifying the SHA-256 checksum on the release page. You can turn
        the permission back off after installing.
      </>
    ),
  },
  {
    title: "Open the app and approve the VPN permission",
    body: (
      <>
        <p>
          Open VeilVPN and tap <strong>Connect</strong> for the first time.
          Android shows a system dialog:{" "}
          <strong>&quot;VeilVPN wants to set up a VPN connection&quot;</strong>.
        </p>
        <ul>
          <li>
            Review that the requesting app is VeilVPN, then tap{" "}
            <strong>OK</strong>.
          </li>
          <li>
            A key icon appears in your status bar whenever the VPN is active.
          </li>
        </ul>
        <p>
          This permission lets the app create the encrypted tunnel — without it,
          the VPN can&apos;t protect your traffic.
        </p>
      </>
    ),
  },
  {
    title: "Create your account or log in",
    body: (
      <>
        <p>
          Tap <strong>Create account</strong>, enter your email, and choose a
          password (minimum 12 characters). Your free 7-day trial starts
          immediately — no credit card needed. Verify your email via the link we
          send you.
        </p>
      </>
    ),
  },
  {
    title: "Connect and choose a server",
    body: (
      <>
        <p>
          Pick a server region (or the recommended fastest server) and tap{" "}
          <strong>Connect</strong>. The kill switch and DNS leak protection are
          on by default.
        </p>
        <p>
          Tip: enable <strong>Always-on VPN</strong> and{" "}
          <strong>Block connections without VPN</strong> in Android&apos;s
          system VPN settings (Settings → Network → VPN → VeilVPN ⚙️) for
          maximum protection — your phone will refuse to send any traffic
          outside the tunnel.
        </p>
      </>
    ),
  },
  {
    title: "Battery optimization note",
    body: (
      <p>
        If the VPN disconnects when your screen is off, exempt VeilVPN from
        battery optimization: Settings → Apps → VeilVPN → Battery →
        <strong> Unrestricted</strong>. This keeps the tunnel alive in the
        background.
      </p>
    ),
  },
];

export default function AndroidGuidePage() {
  return (
    <GuideShell
      os="Android"
      icon="🤖"
      asset={RELEASE_ASSETS.androidApk}
      intro="Install VeilVPN on Android 8.0+ straight from the APK — no Play Store needed. Takes about five minutes."
      steps={STEPS}
    />
  );
}
