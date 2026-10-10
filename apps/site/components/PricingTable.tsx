import Link from "next/link";
import { APP_URL, PLANS } from "@/lib/config";

function Check() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-emerald-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 111.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function PricingTable() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={`relative flex flex-col rounded-2xl border p-6 ${
            plan.highlight
              ? "border-emerald-400/60 bg-gradient-to-b from-emerald-400/10 to-transparent shadow-xl shadow-emerald-500/10"
              : "border-white/10 bg-ink-900/60"
          }`}
        >
          {plan.highlight && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-ink-950">
              Most popular
            </span>
          )}
          <h3 className="text-lg font-bold text-white">{plan.name}</h3>
          <p className="mt-3">
            <span className="text-4xl font-extrabold tracking-tight text-white">
              {plan.price}
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-400">{plan.priceNote}</p>
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-300">
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-semibold">
              {plan.devices} {plan.devices === 1 ? "device" : "devices"}
            </span>
          </p>
          <ul className="mt-5 flex-1 space-y-2.5">
            {plan.features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2.5 text-sm text-slate-300"
              >
                <Check />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href={APP_URL || "/download"}
            className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-bold transition ${
              plan.highlight
                ? "bg-emerald-400 text-ink-950 hover:bg-emerald-300"
                : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            {plan.cta}
          </Link>
          <p className="mt-3 text-center text-xs text-slate-500">
            Create your account &amp; subscribe inside the app
          </p>
        </div>
      ))}
    </div>
  );
}
