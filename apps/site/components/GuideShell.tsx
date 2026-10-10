import Link from "next/link";
import { APP_NAME, APP_VERSION, releaseDownloadUrl } from "@/lib/config";

export interface GuideStepData {
  title: string;
  body: React.ReactNode;
  warning?: React.ReactNode;
}

export function GuideShell({
  os,
  icon,
  asset,
  intro,
  steps,
}: {
  os: string;
  icon: string;
  asset: string;
  intro: string;
  steps: GuideStepData[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <Link
        href="/download"
        className="text-sm font-medium text-emerald-300 hover:text-emerald-200"
      >
        ← Back to downloads
      </Link>
      <div className="mt-6 flex items-center gap-4">
        <span className="text-5xl" aria-hidden>
          {icon}
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
            Setup guide
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {APP_NAME} for {os}
          </h1>
        </div>
      </div>
      <p className="mt-4 text-slate-400">{intro}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href={releaseDownloadUrl(asset)}
          className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-emerald-300"
        >
          ⬇ Download {asset} ({APP_VERSION})
        </a>
      </div>

      <ol className="mt-10 space-y-6">
        {steps.map((s, i) => (
          <li
            key={i}
            className="rounded-2xl border border-white/10 bg-ink-900/60 p-6"
          >
            <div className="flex items-start gap-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-sm font-extrabold text-emerald-300">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white">{s.title}</h2>
                <div className="mt-2 text-sm leading-relaxed text-slate-300 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-emerald-200 [&_strong]:text-white">
                  {s.body}
                </div>
                {s.warning && (
                  <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3.5 text-sm leading-relaxed text-amber-100/90">
                    {s.warning}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-center">
        <h2 className="font-bold text-white">You&apos;re protected 🎉</h2>
        <p className="mt-2 text-sm text-slate-400">
          The kill switch and DNS leak protection are on by default. Explore
          split tunneling in Settings when you need it.
        </p>
        <Link
          href="/faq"
          className="mt-4 inline-block text-sm font-medium text-emerald-300 hover:text-emerald-200"
        >
          Questions? Read the FAQ →
        </Link>
      </div>
    </div>
  );
}
