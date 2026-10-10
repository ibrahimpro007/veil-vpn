"use client";

import { useState } from "react";

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-ink-900/60">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
            >
              <span className="font-semibold text-white">{item.q}</span>
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-lg text-emerald-300 transition-transform ${
                  isOpen ? "rotate-45 bg-white/5" : ""
                }`}
                aria-hidden
              >
                +
              </span>
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-sm leading-relaxed text-slate-300 sm:px-6 sm:text-[15px]">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
