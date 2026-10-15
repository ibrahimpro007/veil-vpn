"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/config";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-lg font-black text-ink-950 shadow-lg shadow-emerald-500/20">
        V
      </span>
      <span className="text-xl font-extrabold tracking-tight text-white">
        {APP_NAME}
      </span>
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink-950/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                pathname === l.href
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/download"
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-ink-950 transition hover:bg-emerald-300"
          >
            Download
          </Link>
        </div>
      </nav>
      {/* Mobile links */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              pathname === l.href ? "bg-white/10 text-white" : "text-slate-300"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
