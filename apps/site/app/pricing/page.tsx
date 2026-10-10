import type { Metadata } from "next";
import PricingTable from "@/components/PricingTable";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Pricing",
  description: `${APP_NAME} pricing: free 7-day trial, Monthly $4.99, Yearly $49.99. Up to 5 devices, no-logs WireGuard VPN. Cancel anytime.`,
};

const COMPARISON: {
  feature: string;
  trial: string;
  monthly: string;
  yearly: string;
}[] = [
  { feature: "Price", trial: "$0", monthly: "$4.99/mo", yearly: "$49.99/yr" },
  { feature: "Trial length", trial: "7 days", monthly: "—", yearly: "—" },
  { feature: "Simultaneous devices", trial: "1", monthly: "5", yearly: "5" },
  { feature: "WireGuard protocol", trial: "✓", monthly: "✓", yearly: "✓" },
  { feature: "Kill switch", trial: "✓", monthly: "✓", yearly: "✓" },
  { feature: "DNS leak protection", trial: "✓", monthly: "✓", yearly: "✓" },
  { feature: "Split tunneling", trial: "✓", monthly: "✓", yearly: "✓" },
  { feature: "All server regions", trial: "✓", monthly: "✓", yearly: "✓" },
  { feature: "Priority support", trial: "—", monthly: "✓", yearly: "✓" },
  {
    feature: "Credit card required",
    trial: "No",
    monthly: "Yes",
    yearly: "Yes",
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
          Pricing
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Simple, honest pricing
        </h1>
        <p className="mt-4 text-slate-400">
          Start with a free 7-day trial — no credit card. Upgrade only if you
          stay. Cancel anytime.
        </p>
      </div>

      <div className="mt-12">
        <PricingTable />
      </div>

      <div className="mx-auto mt-14 max-w-4xl">
        <h2 className="text-center text-2xl font-bold text-white">
          Plan comparison
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse bg-ink-900/60 text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="px-5 py-4 font-semibold text-slate-400">
                  Feature
                </th>
                <th className="px-5 py-4 font-semibold text-white">
                  Free Trial
                </th>
                <th className="px-5 py-4 font-semibold text-white">Monthly</th>
                <th className="px-5 py-4 font-semibold text-white">Yearly</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr
                  key={row.feature}
                  className={i % 2 === 0 ? "bg-white/[0.02]" : ""}
                >
                  <td className="px-5 py-3.5 font-medium text-slate-300">
                    {row.feature}
                  </td>
                  <td className="px-5 py-3.5 text-slate-300">{row.trial}</td>
                  <td className="px-5 py-3.5 text-slate-300">{row.monthly}</td>
                  <td className="px-5 py-3.5 text-slate-300">{row.yearly}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-6">
          <h3 className="font-bold text-white">How subscribing works</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            There&apos;s no web checkout —{" "}
            <strong className="text-white">subscribe inside the app</strong>{" "}
            after you create your account. We do this to keep the site simple
            and the billing flow where your account already lives. Cancel
            anytime from the app&apos;s billing section; you keep access until
            the end of your billing period.
          </p>
        </div>

        <p className="mt-8 text-center text-sm text-slate-500">
          Prices in USD. Yearly plan saves about 17% vs paying monthly.
        </p>
      </div>
    </div>
  );
}
