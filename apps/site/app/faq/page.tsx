import type { Metadata } from "next";
import FaqAccordion from "@/components/FaqAccordion";
import JsonLd from "@/components/JsonLd";
import { FAQ_ITEMS } from "./faqItems";
import { faqJsonLd } from "./faqJsonLd";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "FAQ",
  description: `Frequently asked questions about ${APP_NAME}: no-logs policy, what data we store, speed, devices, refunds, and why we're not on app stores.`,
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <JsonLd data={faqJsonLd()} />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
        FAQ
      </p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white">
        Frequently asked questions
      </h1>
      <p className="mt-4 text-slate-400">
        Straight answers about privacy, pricing, and how {APP_NAME} works.
      </p>
      <div className="mt-10">
        <FaqAccordion items={FAQ_ITEMS} />
      </div>
    </div>
  );
}
