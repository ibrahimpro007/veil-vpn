import Link from "next/link";
import { Logo } from "./Navbar";
import { APP_NAME } from "@/lib/config";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/download", label: "Download" },
      { href: "/blog", label: "Blog" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Setup guides",
    links: [
      { href: "/guides/windows", label: "Windows" },
      { href: "/guides/android", label: "Android" },
      { href: "/guides/macos", label: "macOS" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/acceptable-use", label: "Acceptable Use" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink-900/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              A no-logs WireGuard VPN. Your traffic is yours — we keep no record
              of it.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
              <span
                className="h-2 w-2 rounded-full bg-emerald-400"
                aria-hidden
              />
              Status: self-reported — all systems operational
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-slate-300 hover:text-emerald-300"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
          <p>
            No-logs VPN · WireGuard® is a registered trademark of Jason A.
            Donenfeld.
          </p>
        </div>
      </div>
    </footer>
  );
}
