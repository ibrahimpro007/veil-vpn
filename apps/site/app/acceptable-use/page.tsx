import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: `${APP_NAME} acceptable use policy: prohibited activities, enforcement, and how to report abuse.`,
};

export default function AcceptableUsePage() {
  return (
    <LegalShell title="Acceptable Use Policy" updated="October 9, 2026">
      <p>
        This policy describes what you may and may not do with {APP_NAME}. It
        applies to everyone using the Service, on every plan including the free
        trial. Violations can lead to enforcement under section 5 below. Our
        no-logs design means we act on <em>reports and complaints</em>, not on
        surveillance — we do not monitor your traffic.
      </p>

      <h2>1. The short version</h2>
      <p>
        Use {APP_NAME} to protect your privacy and browse freely — not to harm
        others, break the law, or abuse the network. If an activity would be
        wrong without a VPN, it&apos;s wrong with one.
      </p>

      <h2>2. Prohibited activities</h2>
      <p>You must not use the Service to:</p>
      <ul>
        <li>
          <strong>Break the law</strong> — including fraud, theft, harassment,
          threats, or distributing illegal content such as CSAM.
        </li>
        <li>
          <strong>Infringe intellectual property</strong> — including
          distributing or downloading copyrighted material without
          authorization.
        </li>
        <li>
          <strong>Attack systems</strong> — hacking, unauthorized access, port
          scanning of third parties, DDoS, or distributing malware, ransomware,
          or phishing.
        </li>
        <li>
          <strong>Spam or abuse</strong> — sending unsolicited bulk messages,
          operating spam infrastructure, or scraping in violation of target
          sites&apos; terms at abusive volumes.
        </li>
        <li>
          <strong>Abuse the Service itself</strong> — reselling access without
          permission, sharing one account across many people, chaining free
          trials with multiple accounts, circumventing device limits or billing,
          or interfering with other users&apos; service.
        </li>
        <li>
          <strong>Evade enforcement</strong> — creating new accounts to dodge a
          suspension or ban.
        </li>
      </ul>

      <h2>3. Network conduct</h2>
      <ul>
        <li>
          Sustained, extreme bandwidth use far beyond typical personal use may
          be rate-limited to protect the network for everyone (see Terms §6).
        </li>
        <li>
          Do not run public-facing servers, exit relays, or Tor exit nodes over
          the Service without prior written permission.
        </li>
      </ul>

      <h2>4. Reporting abuse</h2>
      <p>
        If you believe someone is misusing {APP_NAME}, email{" "}
        <strong>abuse@veil-vpn.example</strong> with:
      </p>
      <ul>
        <li>A description of the abuse and when it occurred (UTC);</li>
        <li>
          Any evidence you have (headers, logs, URLs) — we cannot look up
          activity ourselves because we keep no logs;
        </li>
        <li>Your contact details for follow-up.</li>
      </ul>
      <p>
        Because of our no-logs architecture, our ability to investigate is
        limited to account-level records (see the Privacy Policy). Reports about
        traffic content generally cannot be corroborated from our side; we act
        where account-level evidence supports a violation.
      </p>

      <h2>5. Enforcement</h2>
      <p>
        We aim for proportionate enforcement. Depending on severity and history,
        we may:
      </p>
      <ol>
        <li>Warn you and ask you to stop;</li>
        <li>Temporarily suspend VPN access;</li>
        <li>
          Permanently terminate the account (no refund for termination for
          cause);
        </li>
        <li>
          Report illegal activity to law enforcement where required by law.
        </li>
      </ol>
      <p>
        Where practical we notify you of enforcement against your account and
        give you a chance to appeal by replying to the notice within 14 days.
        For severe or illegal activity we may act immediately without prior
        notice.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update this policy with 14 days&apos; notice by email or in-app.
        Continued use after the effective date means you accept the updated
        policy.
      </p>
    </LegalShell>
  );
}
