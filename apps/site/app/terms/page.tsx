import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `${APP_NAME} terms of service: accounts, trials, subscriptions, refunds, and acceptable use.`,
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="October 9, 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of {APP_NAME}{" "}
        (&quot;the Service&quot;), provided by us (&quot;we&quot;,
        &quot;us&quot;). By creating an account or using the Service, you agree
        to these Terms and to our <a href="/privacy">Privacy Policy</a> and{" "}
        <a href="/acceptable-use">Acceptable Use Policy</a>.
      </p>

      <h2>1. The service</h2>
      <p>
        {APP_NAME} is a virtual private network (VPN) service using the
        WireGuard protocol. We provide encrypted tunneling between your device
        and our servers, plus client apps with features such as a kill switch,
        DNS leak protection, and split tunneling. We operate a strict no-logs
        policy as described in our Privacy Policy.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must be at least 16 years old to use the Service.</li>
        <li>
          You register with an email address and a password of at least 12
          characters. You are responsible for keeping your credentials
          confidential and for all activity under your account.
        </li>
        <li>
          One account per person. Sharing account credentials with others is not
          permitted; use your device slots instead.
        </li>
        <li>You must verify your email address to keep your account active.</li>
      </ul>

      <h2>3. Free trial</h2>
      <ul>
        <li>
          New accounts receive a <strong>7-day free trial</strong> with full VPN
          access on 1 device. No credit card is required.
        </li>
        <li>
          The trial is limited to one per person. Creating multiple accounts to
          chain trials violates these Terms and may lead to suspension.
        </li>
        <li>
          When the trial ends, your account remains but VPN access is paused
          until you subscribe.
        </li>
      </ul>

      <h2>4. Subscriptions and billing</h2>
      <ul>
        <li>
          Paid plans: <strong>Monthly ($4.99/month)</strong> and{" "}
          <strong>Yearly ($49.99/year)</strong>, each covering up to 5 devices.
          Prices are in USD and exclude any applicable taxes.
        </li>
        <li>
          Subscriptions are purchased and managed{" "}
          <strong>inside the app</strong>. By subscribing you authorize
          recurring charges until you cancel.
        </li>
        <li>
          <strong>Cancellation:</strong> cancel anytime from the app&apos;s
          billing section. Cancellation takes effect at the end of the current
          billing period; you keep access until then. No cancellation fees.
        </li>
        <li>
          <strong>Refunds:</strong> new purchases are refundable within 14 days;
          renewals within 48 hours of the charge. After those windows, refunds
          are at our discretion. Contact support from your account email to
          request one.
        </li>
        <li>
          Failed payments may pause your VPN access until billing is resolved.
          We may change prices with at least 30 days&apos; notice; the new price
          applies from your next renewal, and you may cancel instead.
        </li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>
        You agree to use the Service only as described in our{" "}
        <a href="/acceptable-use">Acceptable Use Policy</a>. In short: no
        illegal activity, no abuse of the network or other users, no
        infringement. Violations can lead to warning, suspension, or termination
        of your account.
      </p>

      <h2>6. Fair use and service quality</h2>
      <p>
        The Service is for personal, non-commercial use unless otherwise agreed.
        We may apply reasonable network management to keep the service usable
        for everyone (for example, throttling accounts engaged in sustained,
        extreme bandwidth consumption far beyond typical personal use). We will
        always prefer the least intrusive measure and will notify you first
        where practical.
      </p>

      <h2>7. No-logs and your responsibility</h2>
      <p>
        Because we keep no logs, we cannot recover your activity history,
        investigate what happened on your connection, or attribute network
        events to you. You are solely responsible for how you use the Service.
        Our no-logs design protects your privacy; it does not shield unlawful
        conduct from consequences imposed by others.
      </p>

      <h2>8. Service availability</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted,
        error-free service. We may perform maintenance, add or retire server
        locations, or update client apps, with reasonable notice for planned
        changes. We are not liable for losses caused by temporary outages.
      </p>

      <h2>9. Intellectual property</h2>
      <p>
        The {APP_NAME} name, logo, website, and client apps are our property or
        licensed to us. You receive a limited, non-transferable license to use
        the client apps for the Service. You may not copy, modify,
        reverse-engineer (except where the law allows), or redistribute them.
      </p>

      <h2>10. Termination</h2>
      <ul>
        <li>
          You may delete your account at any time from inside the app (see the
          Privacy Policy for what deletion removes).
        </li>
        <li>
          We may suspend or terminate accounts that violate these Terms or the
          Acceptable Use Policy, with notice where practical. Paid time is not
          refunded on termination for cause, except where the law requires.
        </li>
        <li>
          We may discontinue the Service with at least 30 days&apos; notice;
          active paid subscriptions will be refunded pro-rata for unused time.
        </li>
      </ul>

      <h2>11. Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided &quot;as is&quot; without warranties of any
        kind, express or implied. A VPN improves privacy but cannot guarantee
        anonymity or security against all threats (for example, malware on your
        device, or information you disclose yourself).
      </p>
      <p>
        To the maximum extent permitted by law, our total liability for any
        claim arising from the Service is limited to the amount you paid us in
        the 12 months before the claim (or $10 if you paid nothing). We are not
        liable for indirect, incidental, or consequential damages.
      </p>

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms; material changes take effect 14 days after we
        notify you by email or in-app notice. Continued use after the effective
        date means you accept the updated Terms. If you disagree, cancel and
        delete your account before then.
      </p>

      <h2>13. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of [Jurisdiction — to be specified
        by the operator]. Disputes will first be addressed through good-faith
        negotiation with our support team; if unresolved, they will be settled
        in the courts of [Jurisdiction]. Nothing here limits your mandatory
        consumer rights.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms: <strong>legal@veil-vpn.example</strong>.
        Support: <strong>support@veil-vpn.example</strong>.
      </p>
    </LegalShell>
  );
}
