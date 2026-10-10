import Link from "next/link";
import type { FaqItem } from "@/components/FaqAccordion";
import { APP_NAME } from "@/lib/config";

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: `What does "${APP_NAME} keeps no logs" actually mean?`,
    a: (
      <>
        <p>
          It means we do not record what you do while connected: no browsing
          history, no DNS queries, no connection timestamps, no bandwidth
          totals, no IP addresses tied to your activity. Our servers are not
          configured to write traffic logs, and our database schema has no place
          to store them — there is deliberately no table or field for activity
          data.
        </p>
      </>
    ),
  },
  {
    q: "What data DO you store about me?",
    a: (
      <>
        <p>Only what is needed to run your account:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Your account email address.</li>
          <li>
            Your password as a PBKDF2-SHA256 (600,000 iterations) hash — we
            never see or store the plaintext password.
          </li>
          <li>
            Your devices&apos; WireGuard public keys (needed to let your devices
            connect).
          </li>
          <li>
            Your subscription status (e.g. trialing, active) so the app knows
            your plan.
          </li>
          <li>
            A coarse, day-granularity &quot;last seen&quot; marker per device —
            the day, never the time.
          </li>
          <li>
            Payment events: the provider&apos;s event ID and a SHA-256 hash of
            the webhook payload, so we can verify payments without storing the
            raw payload.
          </li>
        </ul>
        <p className="mt-2">
          That&apos;s it. See our{" "}
          <Link href="/privacy" className="text-emerald-300 hover:underline">
            privacy policy
          </Link>{" "}
          for the full list.
        </p>
      </>
    ),
  },
  {
    q: "Can you see which websites I visit?",
    a: (
      <p>
        No. Your traffic is encrypted between your device and our server, and we
        do not log DNS requests or destinations. Even if someone asked us for
        your browsing history, we would have nothing to give them — because we
        never recorded it.
      </p>
    ),
  },
  {
    q: "Where are you based, and what jurisdiction applies?",
    a: (
      <p>
        {APP_NAME} is an independent project operated as a lean, free-tier
        service. We publish exactly what we collect (see above and our{" "}
        <Link href="/privacy" className="text-emerald-300 hover:underline">
          privacy policy
        </Link>
        ) so you don&apos;t have to trust a jurisdiction — you can verify that
        the data simply doesn&apos;t exist. If compelled by lawful process, we
        can only disclose the minimal account records described here; there are
        no activity logs to disclose.
      </p>
    ),
  },
  {
    q: "How fast is it? Will it slow down my connection?",
    a: (
      <p>
        We use the WireGuard protocol, which is one of the fastest VPN protocols
        available thanks to its small, modern codebase. Any VPN adds some
        overhead from encryption and routing, but in normal use you should
        notice little difference for browsing, streaming, and video calls. Speed
        also depends on the server you choose and your own connection — picking
        a nearby server in the app gives the best results.
      </p>
    ),
  },
  {
    q: "Does it protect against DNS and IPv6 leaks?",
    a: (
      <p>
        Yes. All DNS requests are routed through the encrypted tunnel to our
        resolvers, so your ISP can&apos;t see your lookups. IPv6 traffic is
        handled inside the tunnel too, and the kill switch blocks all traffic if
        the VPN connection drops unexpectedly — so nothing leaks outside the
        tunnel.
      </p>
    ),
  },
  {
    q: "How many devices can I use at once?",
    a: (
      <p>
        The free 7-day trial covers 1 device. Paid plans (Monthly and Yearly)
        cover up to 5 devices simultaneously. You can manage your devices from
        inside the app and remove old ones anytime.
      </p>
    ),
  },
  {
    q: "Can I torrent / use P2P?",
    a: (
      <p>
        P2P traffic is technically permitted on the network, but you must comply
        with our{" "}
        <Link
          href="/acceptable-use"
          className="text-emerald-300 hover:underline"
        >
          acceptable use policy
        </Link>
        : don&apos;t use the service to infringe copyrights or break the law.
        Abuse complaints tied to illegal activity can lead to account
        suspension.
      </p>
    ),
  },
  {
    q: "How do refunds work?",
    a: (
      <p>
        If you&apos;re not happy, contact support within 14 days of a new
        purchase for a refund — no interrogation. Renewals are refundable within
        48 hours of the charge. After those windows, refunds are handled case by
        case. To request one, email support from the address on your account.
      </p>
    ),
  },
  {
    q: "How do I cancel my subscription?",
    a: (
      <p>
        Cancel anytime from inside the app (billing section) — it takes effect
        at the end of your current billing period, and you keep access until
        then. There are no cancellation fees and no dark patterns. Yearly plans
        are not prorated on cancellation, but you keep the full year you paid
        for.
      </p>
    ),
  },
  {
    q: "How do I delete my account and data?",
    a: (
      <p>
        You can export your data at any time and request full deletion from
        inside the app, or by emailing support. Deleting your account removes
        your profile, devices, and keys; payment records required for tax and
        accounting are retained in anonymized form as required by law. See the{" "}
        <Link href="/privacy" className="text-emerald-300 hover:underline">
          privacy policy
        </Link>{" "}
        for retention details.
      </p>
    ),
  },
  {
    q: "Why isn't the app on the App Store or Google Play?",
    a: (
      <p>
        Honest answer: budget. We run {APP_NAME} on free tiers, and paid
        developer programs (Apple Developer, Google Play) cost money every year.
        Instead of raising prices to cover store fees, we distribute directly
        through GitHub Releases — free for us, free of store restrictions for
        you. Downloads are checksummed (SHA-256) so you can verify them.
      </p>
    ),
  },
  {
    q: "Is the Windows/macOS installer safe? Why the security warning?",
    a: (
      <p>
        Our installers are signed with a self-signed certificate, not an
        expensive commercial code-signing certificate — so Windows SmartScreen
        and macOS Gatekeeper show a warning on first run. The files are safe;
        verify the SHA-256 checksum published on the release page, then follow
        the bypass steps in our{" "}
        <Link
          href="/guides/windows"
          className="text-emerald-300 hover:underline"
        >
          Windows guide
        </Link>{" "}
        or{" "}
        <Link href="/guides/macos" className="text-emerald-300 hover:underline">
          macOS guide
        </Link>
        .
      </p>
    ),
  },
  {
    q: "Do you offer a free trial?",
    a: (
      <p>
        Yes — a 7-day free trial with full VPN access on 1 device, no credit
        card required. Just download the app, create an account, and you&apos;re
        protected. When the trial ends you can upgrade to Monthly ($4.99/mo) or
        Yearly ($49.99/yr) inside the app.
      </p>
    ),
  },
];
