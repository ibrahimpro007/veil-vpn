import type { Metadata } from "next";
import { GuideShell, type GuideStepData } from "@/components/GuideShell";
import { RELEASE_ASSETS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Windows setup guide",
  description:
    "Step-by-step: install VeilVPN on Windows 10/11, get past SmartScreen, grant VPN permission, log in, and connect.",
};

const STEPS: GuideStepData[] = [
  {
    title: "Download the installer",
    body: (
      <p>
        Download <code>{RELEASE_ASSETS.windowsExe}</code> from the{" "}
        <a href="/download" className="text-emerald-300 hover:underline">
          download page
        </a>{" "}
        (or the button above) and double-click it to install.
      </p>
    ),
  },
  {
    title: "Verify the checksum (recommended)",
    body: (
      <>
        <p>Open PowerShell in your Downloads folder and run:</p>
        <p>
          <code>Get-FileHash .\VeilVPN-Setup.exe -Algorithm SHA256</code>
        </p>
        <p>
          Compare the output with the SHA-256 checksum on the GitHub release
          page. They must match exactly before you continue.
        </p>
      </>
    ),
  },
  {
    title: "Run the installer — handle the SmartScreen prompt",
    body: (
      <>
        <p>
          Double-click the installer. Because our builds are signed with a
          self-signed certificate (not a paid commercial one), Windows
          SmartScreen will show{" "}
          <strong>&quot;Windows protected your PC&quot;</strong>.
        </p>
        <ul>
          <li>
            Click <strong>More info</strong>.
          </li>
          <li>Check the publisher name matches VeilVPN.</li>
          <li>
            Click <strong>Run anyway</strong>.
          </li>
        </ul>
        <p>
          Follow the installer prompts (Install for all users is recommended)
          and click Finish.
        </p>
      </>
    ),
    warning: (
      <>
        Only click &quot;Run anyway&quot; if you downloaded the file from our
        official release page <em>and</em> the checksum matched. Never do this
        for files from anywhere else.
      </>
    ),
  },
  {
    title: "Approve the VPN network adapter",
    body: (
      <p>
        On first launch, Windows asks to install a virtual network adapter (the
        WireGuard tunnel interface). Click <strong>Install</strong> /
        <strong> Yes</strong> on the UAC prompt — this is required for the VPN
        to route your traffic.
      </p>
    ),
  },
  {
    title: "Create your account or log in",
    body: (
      <>
        <p>
          The app opens to the sign-in screen. New here? Tap{" "}
          <strong>Create account</strong>, enter your email, and choose a
          password (minimum 12 characters). Your free 7-day trial starts
          immediately — no credit card needed.
        </p>
        <p>
          Check your inbox for the verification email and click the link to
          verify.
        </p>
      </>
    ),
  },
  {
    title: "Connect",
    body: (
      <>
        <p>
          Pick a server region from the list (or use the recommended fastest
          server) and tap the big <strong>Connect</strong> button. The shield
          turns green when you&apos;re protected.
        </p>
        <p>
          The <strong>kill switch</strong> and{" "}
          <strong>DNS leak protection</strong> are enabled by default —
          you&apos;ll find them under Settings → Privacy if you ever want to
          review them.
        </p>
      </>
    ),
  },
  {
    title: "Try split tunneling (optional)",
    body: (
      <p>
        Go to Settings → Split tunneling to choose apps that bypass the VPN
        (useful for banking apps or local network printers) while everything
        else stays protected.
      </p>
    ),
  },
];

export default function WindowsGuidePage() {
  return (
    <GuideShell
      os="Windows"
      icon="🪟"
      asset={RELEASE_ASSETS.windowsExe}
      intro="Install VeilVPN on Windows 10 or 11 (64-bit) in about five minutes — including the SmartScreen prompt you'll see on first install."
      steps={STEPS}
    />
  );
}
