import Link from "next/link";
import dynamic from "next/dynamic";
import type { Metadata } from "next";
import DownloadButtons from "@/components/DownloadButtons";
import PricingTable from "@/components/PricingTable";
import FaqAccordion from "@/components/FaqAccordion";
import Reveal from "@/components/Reveal";
import { APP_NAME } from "@/lib/config";
import { FAQ_ITEMS } from "./faq/faqItems";

// GSAP parallax is decorative: lazy-load it so it never blocks first paint.
const HeroParallax = dynamic(() => import("@/components/HeroParallax"), {
  ssr: false,
});

export const metadata: Metadata = {
  title: `${APP_NAME} — No-Logs WireGuard VPN`,
};

function Section({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      {eyebrow && (
        <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {sub && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
          {sub}
        </p>
      )}
      <div className="mt-10">{children}</div>
    </section>
  );
}

const BADGES = [
  {
    icon: "🛡️",
    title: "Strict no-logs",
    text: "No traffic, DNS, or connection logs. Ever.",
  },
  {
    icon: "🔍",
    title: "Open by design",
    text: "Minimal data, documented in our privacy policy.",
  },
  {
    icon: "🔑",
    title: "Modern crypto",
    text: "WireGuard with audited, state-of-the-art encryption.",
  },
  {
    icon: "⚖️",
    title: "Your data rights",
    text: "Export or delete your account data anytime.",
  },
];

const FEATURES = [
  {
    icon: "⚡",
    title: "WireGuard speed",
    text: "Built on the WireGuard protocol — lightweight, fast, and quick to reconnect when you switch networks.",
  },
  {
    icon: "🔪",
    title: "Kill switch",
    text: "If the VPN drops, your internet is blocked instantly. No accidental exposure, no silent leaks.",
  },
  {
    icon: "🕵️",
    title: "DNS leak protection",
    text: "All DNS requests go through the encrypted tunnel. Your ISP never sees the sites you look up.",
  },
  {
    icon: "🧭",
    title: "Split tunneling",
    text: "Choose which apps use the VPN and which connect directly — banking apps and local services keep working.",
  },
  {
    icon: "📱",
    title: "5 devices",
    text: "One subscription protects up to 5 devices at the same time on paid plans.",
  },
  {
    icon: "🌐",
    title: "IPv6 & leak safeguards",
    text: "IPv6 traffic is handled inside the tunnel so it can't bypass your protection.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Download the app",
    text: "Grab the installer for Windows, macOS, or Android straight from our GitHub releases — no app store needed.",
  },
  {
    n: "2",
    title: "Create your account",
    text: "Sign up in the app with just an email. Start with a free 7-day trial — no credit card required.",
  },
  {
    n: "3",
    title: "Tap connect",
    text: "Pick a server region and tap connect. The kill switch and DNS protection turn on automatically.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <HeroParallax>
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(60rem 30rem at 50% -10%, rgba(52,211,153,0.18), transparent 60%), radial-gradient(40rem 24rem at 85% 20%, rgba(34,211,238,0.12), transparent 60%)",
            }}
          />
        </HeroParallax>
        {/* Static fallback glow for no-JS / pre-hydration is rendered by
            HeroParallax after mount; the section keeps its min-height so
            there is no layout shift. */}
        <div className="relative mx-auto max-w-4xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm font-medium text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              No-logs VPN · Free 7-day trial
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
              Your traffic is yours.
              <span className="block bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                We keep no record of it.
              </span>
            </h1>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
              {APP_NAME} is a fast, no-logs WireGuard VPN with a kill switch, DNS
              leak protection, and split tunneling — for Windows, macOS, and
              Android.
            </p>
            <div className="mt-10">
              <DownloadButtons />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Free 7-day trial · No credit card required · Cancel anytime
            </p>
          </Reveal>
        </div>
      </section>

      {/* NO-LOGS BADGES */}
      <section className="border-y border-white/10 bg-ink-900/40">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {BADGES.map((b, i) => (
            <Reveal key={b.title} delay={(i % 4) * 0.08}>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-ink-950/60 p-4">
                <span className="text-2xl" aria-hidden>
                  {b.icon}
                </span>
                <div>
                  <h3 className="font-bold text-white">{b.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{b.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <Section
        eyebrow="Features"
        title="Everything a VPN should do. Nothing it shouldn't."
        sub="Modern protocol, sensible defaults, and controls that stay out of your way."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08}>
              <div className="h-full rounded-2xl border border-white/10 bg-ink-900/60 p-6 transition hover:border-emerald-400/40">
                <div className="text-3xl" aria-hidden>
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {f.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section
        eyebrow="How it works"
        title="Protected in three steps"
        sub="No accounts to link, no stores to visit — download, sign up, connect."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <div className="relative h-full rounded-2xl border border-white/10 bg-ink-900/60 p-6">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400 text-lg font-extrabold text-ink-950">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {s.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/download"
            className="inline-block rounded-2xl bg-emerald-400 px-8 py-3.5 font-bold text-ink-950 transition hover:bg-emerald-300"
          >
            Get {APP_NAME} now
          </Link>
        </div>
      </Section>

      {/* NETWORK */}
      <section className="border-y border-white/10 bg-ink-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
            Network
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            A growing network, honestly presented
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            Our servers come online as they are provisioned and register
            themselves with the control plane — we don&apos;t publish a fake
            list of locations we don&apos;t operate. Open the app to see the
            live, current server list with real availability.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
            {[
              { k: "Protocol", v: "WireGuard" },
              { k: "Server list", v: "Live in the app" },
              { k: "Logging", v: "None — no traffic logs" },
            ].map((s) => (
              <div
                key={s.k}
                className="rounded-2xl border border-white/10 bg-ink-950/60 p-5 text-center"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {s.k}
                </p>
                <p className="mt-1 font-bold text-white">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING PREVIEW */}
      <Section
        eyebrow="Pricing"
        title="Simple, honest pricing"
        sub="Start free. Pay only if you stay. Cancel anytime from inside the app."
      >
        <PricingTable />
        <p className="mt-6 text-center">
          <Link
            href="/pricing"
            className="font-medium text-emerald-300 hover:text-emerald-200"
          >
            Compare plans in detail →
          </Link>
        </p>
      </Section>

      {/* FAQ PREVIEW */}
      <Section eyebrow="FAQ" title="Questions, answered">
        <FaqAccordion items={FAQ_ITEMS.slice(0, 5)} />
        <p className="mt-6 text-center">
          <Link
            href="/faq"
            className="font-medium text-emerald-300 hover:text-emerald-200"
          >
            Read all FAQs →
          </Link>
        </p>
      </Section>
    </>
  );
}
