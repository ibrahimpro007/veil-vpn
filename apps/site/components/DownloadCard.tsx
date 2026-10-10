"use client";

import Link from "next/link";
import {
  APP_VERSION,
  GITHUB_REPO_IS_PLACEHOLDER,
  releaseDownloadUrl,
} from "@/lib/config";

export interface DownloadOption {
  os: "Windows" | "Android" | "macOS";
  asset: string;
  altAssets?: { label: string; asset: string }[];
  icon: string;
  description: string;
  guideHref: string;
  fileNote: string;
}

export default function DownloadCard({
  option,
  highlighted = false,
}: {
  option: DownloadOption;
  highlighted?: boolean;
}) {
  const url = releaseDownloadUrl(option.asset);

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 transition ${
        highlighted
          ? "border-emerald-400/60 bg-gradient-to-b from-emerald-400/10 to-transparent shadow-xl shadow-emerald-500/10"
          : "border-white/10 bg-ink-900/60 hover:border-white/20"
      }`}
    >
      {highlighted && (
        <span className="absolute -top-3 left-6 rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-ink-950">
          Detected: your device
        </span>
      )}
      <div className="text-4xl" aria-hidden>
        {option.icon}
      </div>
      <h3 className="mt-4 text-xl font-bold text-white">{option.os}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
        {option.description}
      </p>

      <dl className="mt-4 space-y-1.5 rounded-xl bg-black/30 p-4 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Version</dt>
          <dd className="font-mono text-slate-200">{APP_VERSION}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">File size</dt>
          <dd className="text-slate-200">{option.fileNote}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Checksum</dt>
          <dd className="text-slate-200">SHA-256 on the release page</dd>
        </div>
      </dl>

      <a
        href={url}
        className={`mt-5 block rounded-xl px-4 py-3 text-center text-sm font-bold transition ${
          highlighted
            ? "bg-emerald-400 text-ink-950 hover:bg-emerald-300"
            : "bg-white/10 text-white hover:bg-white/15"
        }`}
      >
        Download for {option.os}
      </a>
      {option.altAssets?.map((alt) => (
        <a
          key={alt.asset}
          href={releaseDownloadUrl(alt.asset)}
          className="mt-2 block rounded-xl border border-white/10 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:bg-white/5"
        >
          {alt.label}
        </a>
      ))}

      <Link
        href={option.guideHref}
        className="mt-3 text-center text-sm font-medium text-emerald-300 hover:text-emerald-200"
      >
        Install steps →
      </Link>

      {GITHUB_REPO_IS_PLACEHOLDER && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs text-amber-200">
          Site operator: set{" "}
          <code className="font-mono">NEXT_PUBLIC_GITHUB_REPO</code> — download
          links are not live yet.
        </p>
      )}
    </div>
  );
}
