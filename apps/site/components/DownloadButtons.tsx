"use client";

import Link from "next/link";
import { useOsDetect } from "@/hooks/useOsDetect";
import { RELEASE_ASSETS, releaseDownloadUrl } from "@/lib/config";

const LABELS: Record<string, { name: string; asset: string; href: string }> = {
  windows: {
    name: "Windows",
    asset: RELEASE_ASSETS.windowsExe,
    href: "/guides/windows",
  },
  macos: {
    name: "macOS",
    asset: RELEASE_ASSETS.macosDmg,
    href: "/guides/macos",
  },
  android: {
    name: "Android",
    asset: RELEASE_ASSETS.androidApk,
    href: "/guides/android",
  },
};

/** Hero download buttons: highlights the button matching the visitor's OS. */
export default function DownloadButtons() {
  const os = useOsDetect();
  const order: string[] =
    os === "windows" || os === "macos" || os === "android"
      ? [os, ...Object.keys(LABELS).filter((k) => k !== os)]
      : Object.keys(LABELS);

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      {order.map((key) => {
        const opt = LABELS[key];
        const isDetected = key === os;
        return (
          <div key={key} className="flex w-full flex-col gap-1.5 sm:w-auto">
            <a
              href={releaseDownloadUrl(opt.asset)}
              className={`rounded-2xl px-6 py-3.5 text-center text-base font-bold transition ${
                isDetected
                  ? "bg-emerald-400 text-ink-950 shadow-lg shadow-emerald-500/30 hover:bg-emerald-300"
                  : "border border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              ⬇ Download for {opt.name}
            </a>
            {isDetected && (
              <span className="text-center text-xs font-medium text-emerald-300">
                Detected your device
              </span>
            )}
          </div>
        );
      })}
      <Link
        href="/download"
        className="mt-1 text-sm font-medium text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white"
      >
        All downloads &amp; versions
      </Link>
    </div>
  );
}
