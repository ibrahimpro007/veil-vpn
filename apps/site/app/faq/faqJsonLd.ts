import { APP_NAME } from "@/lib/config";

/**
 * Plain-text Q&A for the FAQPage JSON-LD schema (kept in sync with faqItems.tsx).
 */
export const FAQ_SCHEMA_QA: { q: string; a: string }[] = [
  {
    q: `What does "${APP_NAME} keeps no logs" actually mean?`,
    a: `${APP_NAME} does not record what you do while connected: no browsing history, no DNS queries, no connection timestamps, no bandwidth totals, and no IP addresses tied to your activity.`,
  },
  {
    q: "What data DO you store about me?",
    a: "Only the minimum needed to run the service: your email address, your subscription status, and anonymous aggregate server health metrics. No traffic or activity data is ever stored.",
  },
  {
    q: "Can you see which websites I visit?",
    a: "No. Traffic is encrypted with WireGuard and we keep no logs of browsing activity, so there is nothing for us — or anyone who asks us — to see.",
  },
  {
    q: "Does it protect against DNS and IPv6 leaks?",
    a: "Yes. All DNS requests go through the encrypted tunnel and IPv6 traffic is handled inside the tunnel, with a kill switch that blocks internet access if the VPN drops.",
  },
  {
    q: "How many devices can I use at once?",
    a: "Paid plans support up to 5 devices simultaneously. The free 7-day trial supports 1 device.",
  },
  {
    q: "Do you offer a free trial?",
    a: `Yes — a free 7-day trial with full features and no credit card required. After the trial, plans start at $4.99/month.`,
  },
];

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_SCHEMA_QA.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
