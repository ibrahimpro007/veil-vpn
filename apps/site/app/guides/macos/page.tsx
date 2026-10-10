import type { Metadata } from "next";
import { GuideShell, type GuideStepData } from "@/components/GuideShell";
import { RELEASE_ASSETS } from "@/lib/config";

export const metadata: Metadata = {
  title: "macOS setup guide",
  description:
    "Step-by-step: install VeilVPN on macOS (Apple Silicon & Intel), open the unsigned DMG via right-click, approve the VPN, log in, and connect.",
};

const STEPS: GuideStepData[] = [
  {
    title: "Download the DMG",
    body: (
      <p>
        Download <code>{RELEASE_ASSETS.macosDmg}</code> from the button above or
        the{" "}
        <a href="/download" className="text-emerald-300 hover:underline">
          download page
        </a>
        . Works on macOS 12+ with Apple Silicon or Intel.
      </p>
    ),
  },
  {
    title: "Verify the checksum (recommended)",
    body: (
      <>
        <p>Open Terminal and run:</p>
        <p>
          <code>shasum -a 256 ~/Downloads/{RELEASE_ASSETS.macosDmg}</code>
        </p>
        <p>
          Compare with the SHA-256 checksum on the GitHub release page — they
          must match exactly.
        </p>
      </>
    ),
  },
  {
    title: "Open the installer with right-click → Open",
    body: (
      <>
        <p>
          Our builds are signed with a self-signed certificate, so
          double-clicking may show{" "}
          <strong>
            &quot;can&apos;t be opened because Apple cannot check it for
            malicious software&quot;
          </strong>
          . Instead:
        </p>
        <ul>
          <li>
            <strong>Right-click</strong> (or Control-click) the VeilVPN app
            inside the DMG.
          </li>
          <li>
            Choose <strong>Open</strong> from the menu, then click{" "}
            <strong>Open</strong> again in the dialog.
          </li>
          <li>Drag VeilVPN into your Applications folder.</li>
        </ul>
        <p>
          You only need the right-click trick once — macOS remembers your choice
          afterwards.
        </p>
      </>
    ),
    warning: (
      <>
        Only bypass Gatekeeper for the DMG you downloaded from our official
        release page <em>after</em> the checksum matched. Never do this for
        files from anywhere else.
      </>
    ),
  },
  {
    title: "Approve the VPN configuration",
    body: (
      <>
        <p>
          On first connect, macOS asks permission to add a VPN configuration:
        </p>
        <ul>
          <li>
            Click <strong>Allow</strong> when prompted. If nothing appears, go
            to System Settings → Privacy &amp; Security and approve it there.
          </li>
          <li>
            You may also need to allow the WireGuard network extension under
            System Settings → Privacy &amp; Security → Extensions.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Create your account or log in",
    body: (
      <p>
        Tap <strong>Create account</strong>, enter your email, and choose a
        password (minimum 12 characters). Your free 7-day trial starts
        immediately — no credit card needed. Verify your email via the link we
        send you.
      </p>
    ),
  },
  {
    title: "Connect",
    body: (
      <>
        <p>
          Choose a server region (or the recommended fastest server) and click{" "}
          <strong>Connect</strong>. The menu-bar icon shows your protected
          status.
        </p>
        <p>
          The <strong>kill switch</strong> and{" "}
          <strong>DNS leak protection</strong> are enabled by default — review
          them under Settings → Privacy anytime.
        </p>
      </>
    ),
  },
];

export default function MacosGuidePage() {
  return (
    <GuideShell
      os="macOS"
      icon="🍎"
      asset={RELEASE_ASSETS.macosDmg}
      intro="Install VeilVPN on macOS 12+ (Apple Silicon and Intel) in about five minutes — including the one-time Gatekeeper step for our self-signed build."
      steps={STEPS}
    />
  );
}
