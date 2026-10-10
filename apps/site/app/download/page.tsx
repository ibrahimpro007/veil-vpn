"use client";

import DownloadCard, { type DownloadOption } from "@/components/DownloadCard";
import { useOsDetect } from "@/hooks/useOsDetect";
import { APP_VERSION, RELEASE_ASSETS } from "@/lib/config";

const OPTIONS: DownloadOption[] = [
  {
    os: "Windows",
    asset: RELEASE_ASSETS.windowsExe,
    icon: "🪟",
    description:
      "Windows 10 / 11 (64-bit). Installer with kill switch, split tunneling, and auto-updates.",
    guideHref: "/guides/windows",
    fileNote: "See release page",
  },
  {
    os: "Android",
    asset: RELEASE_ASSETS.androidApk,
    icon: "🤖",
    description:
      "Android 8.0+. Direct APK download — install from your browser, no Play Store needed.",
    guideHref: "/guides/android",
    fileNote: "See release page",
  },
  {
    os: "macOS",
    asset: RELEASE_ASSETS.macosDmg,
    icon: "🍎",
    description:
      "macOS 12+ (Apple Silicon & Intel). DMG installer with system-wide kill switch.",
    guideHref: "/guides/macos",
    fileNote: "See release page",
  },
];

const OS_TO_CARD: Record<string, number> = { windows: 0, android: 1, macos: 2 };

export default function DownloadPage() {
  const os = useOsDetect();
  const highlightIndex = OS_TO_CARD[os] ?? -1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
          Download
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Get VeilVPN
        </h1>
        <p className="mt-4 text-slate-400">
          Version{" "}
          <span className="font-mono text-slate-200">{APP_VERSION}</span> · Free
          7-day trial · No credit card required
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-bold text-amber-200">
          <span aria-hidden>⚠️</span> Direct download — read this first
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-amber-100/90">
          <li>
            <strong>Not on app stores.</strong> We run on free tiers, so we skip
            paid store developer programs and distribute directly via GitHub
            Releases.
          </li>
          <li>
            <strong>Self-signed installers.</strong> Windows and macOS builds
            are signed with a self-signed certificate, so you&apos;ll see a
            SmartScreen / Gatekeeper prompt. That&apos;s expected —{" "}
            <em>always verify the SHA-256 checksum</em> published on the release
            page before installing.
          </li>
          <li>
            See the step-by-step guides linked under each card for the exact
            prompts you&apos;ll see.
          </li>
        </ul>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {OPTIONS.map((opt, i) => (
          <DownloadCard
            key={opt.os}
            option={opt}
            highlighted={i === highlightIndex}
          />
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-white/10 bg-ink-900/60 p-6">
        <h2 className="font-bold text-white">Verifying your download</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
          <li>
            On the GitHub release page, copy the <strong>SHA-256</strong>{" "}
            checksum shown next to your file.
          </li>
          <li>
            Compute the checksum of the file you downloaded:
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-slate-400">
              <li>
                Windows (PowerShell):{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-emerald-200">
                  Get-FileHash .\VeilVPN-Setup.exe -Algorithm SHA256
                </code>
              </li>
              <li>
                macOS / Linux:{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-emerald-200">
                  shasum -a 256 VeilVPN.dmg
                </code>
              </li>
              <li>
                Android: check the checksum in your file manager app or with{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-emerald-200">
                  sha256sum
                </code>{" "}
                via Termux/ADB.
              </li>
            </ul>
          </li>
          <li>
            The two hashes must match exactly. If they don&apos;t,{" "}
            <strong>do not install</strong> — re-download and contact support.
          </li>
        </ol>
      </div>

      <p className="mt-10 text-center text-sm text-slate-500">
        iOS and Linux clients are not available yet.{" "}
        <span className="text-slate-400">
          Windows, macOS, and Android are fully supported today.
        </span>
      </p>
    </div>
  );
}
