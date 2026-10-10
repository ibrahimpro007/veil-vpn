import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `${APP_NAME} privacy policy: our no-logs commitment, exactly what data we collect, what we never collect, retention, and your rights.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="October 9, 2026">
      <p>
        {APP_NAME} (&quot;we&quot;, &quot;us&quot;) is a no-logs VPN service.
        This policy explains what data we collect, what we deliberately{" "}
        <strong>never</strong> collect, and your rights over your data. It is
        written to match how our systems actually work — if a data type is not
        listed here as collected, we do not have it.
      </p>

      <h2>1. The no-logs commitment</h2>
      <p>
        We do not log your VPN activity. Specifically, we never record, store,
        or share:
      </p>
      <ul>
        <li>Websites you visit, apps you use, or services you access;</li>
        <li>DNS queries or responses;</li>
        <li>Connection or disconnection timestamps;</li>
        <li>Bandwidth used or session durations;</li>
        <li>Your IP address tied to any activity;</li>
        <li>The VPN server you connected to, tied to your identity.</li>
      </ul>
      <p>
        Our servers are configured not to write traffic logs, and our database
        schema contains no table or field capable of storing activity data.
        There is nothing to hand over, sell, or leak — because it was never
        recorded.
      </p>

      <h2>2. What we do collect</h2>
      <p>
        To operate accounts and billing, we store only the minimum necessary:
      </p>
      <h3>Account data</h3>
      <ul>
        <li>
          <strong>Email address</strong> — for login, verification, password
          resets, and service notices.
        </li>
        <li>
          <strong>Password hash</strong> — your password is stored only as an
          PBKDF2-SHA256 (600,000 iterations) hash. We never see or store the
          plaintext password.
        </li>
        <li>
          <strong>Email verification / password-reset tokens</strong> —
          single-use, short-lived, deleted after use.
        </li>
      </ul>
      <h3>Device data</h3>
      <ul>
        <li>
          <strong>WireGuard public keys</strong> for each device you register —
          required for your devices to authenticate to our servers. (Public keys
          cannot be used to decrypt your traffic.)
        </li>
        <li>
          <strong>Coarse &quot;last seen&quot; day</strong> per device (calendar
          day only, e.g. 20261009) — used to show you which devices are stale.
          We never store precise connection times.
        </li>
      </ul>
      <h3>Subscription &amp; payment data</h3>
      <ul>
        <li>
          <strong>Subscription status</strong> (e.g. trialing, active, past_due)
          and plan — so the app can enforce your entitlements.
        </li>
        <li>
          <strong>Payment events:</strong> the payment provider&apos;s event ID
          and a SHA-256 hash of the raw webhook payload, used to verify payments
          and prevent double-processing. The raw payload is never stored.
        </li>
        <li>
          We do <strong>not</strong> store full credit-card numbers. Card
          processing is handled by our payment provider.
        </li>
      </ul>
      <h3>Operational records</h3>
      <ul>
        <li>
          <strong>Audit logs</strong> of administrative actions contain only
          internal IDs and action metadata — no personal data.
        </li>
        <li>
          <strong>Abuse flags</strong> may be recorded if your account is
          reported for violating the{" "}
          <a href="/acceptable-use">Acceptable Use Policy</a> (e.g. the
          reporter&apos;s evidence reference and our decision). These contain no
          traffic data.
        </li>
      </ul>

      <h2>3. What we never do with your data</h2>
      <ul>
        <li>We never sell personal data.</li>
        <li>We never use your data for advertising or profiling.</li>
        <li>
          We never share account data with third parties except our payment
          processor (to take payment) and infrastructure providers (to host the
          service), under strict contractual limits.
        </li>
      </ul>

      <h2>4. Legal requests</h2>
      <p>
        If we receive a lawful order (subpoena, court order), we can only
        disclose the minimal account records described in section 2. We have no
        activity logs, browsing history, or connection records to disclose —
        those records do not exist. Where legally permitted, we will notify you
        of requests targeting your account.
      </p>

      <h2>5. Data retention</h2>
      <ul>
        <li>
          <strong>Active accounts:</strong> account, device, and subscription
          data are kept while your account exists.
        </li>
        <li>
          <strong>Deleted accounts:</strong> deleting your account removes your
          profile, devices, keys, and tokens. Payment event hashes required for
          tax and accounting may be retained in anonymized form as required by
          law.
        </li>
        <li>
          <strong>Backups:</strong> encrypted backups may retain deleted data
          for up to 30 days before rolling off.
        </li>
      </ul>

      <h2>6. Your rights (including GDPR)</h2>
      <p>You have the right to:</p>
      <ul>
        <li>
          <strong>Access</strong> — export everything we hold about you from
          inside the app (or request it from support).
        </li>
        <li>
          <strong>Correction</strong> — fix inaccurate account data (e.g. update
          your email in the app).
        </li>
        <li>
          <strong>Deletion</strong> — delete your account and associated data
          from inside the app or by contacting support.
        </li>
        <li>
          <strong>Portability</strong> — receive your data in a structured,
          machine-readable format.
        </li>
        <li>
          <strong>Objection / restriction</strong> — object to or restrict
          processing as provided by applicable law.
        </li>
      </ul>
      <p>
        We respond to rights requests within 30 days. EU/UK users may also
        complain to their local supervisory authority.
      </p>

      <h2>7. Security</h2>
      <p>
        We protect account data with modern practices: PBKDF2-SHA256 password
        hashing, short-lived signed access tokens, rotating refresh tokens with
        reuse detection, encrypted admin credentials, and TLS everywhere. No
        system is perfect — if you believe your account is compromised, reset
        your password and revoke your devices in the app immediately, then
        contact support.
      </p>

      <h2>8. Children</h2>
      <p>
        {APP_NAME} is not directed at children under 16, and we do not knowingly
        collect their data. If you believe a child has created an account,
        contact us and we will delete it.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        If we change this policy, we will update the date above and, for
        material changes, notify you by email or in-app notice at least 14 days
        before the change takes effect. The no-logs commitment in section 1 will
        never be weakened without clear, advance notice and your right to
        cancel.
      </p>

      <h2>10. Contact</h2>
      <p>
        For privacy questions or rights requests:{" "}
        <strong>privacy@veil-vpn.example</strong>. For general support:{" "}
        <strong>support@veil-vpn.example</strong>.
      </p>
    </LegalShell>
  );
}
