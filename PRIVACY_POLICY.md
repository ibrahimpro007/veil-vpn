# VeilVPN — Privacy Policy

**Effective:** October 9, 2026

VeilVPN ("we", "us") is a no-logs VPN service. This policy explains what
data we collect, what we deliberately **never** collect, and your rights
over your data. It is written to match how our systems actually work — if a
data type is not listed here as collected, we do not have it.

## 1. The no-logs commitment

We do not log your VPN activity. We never record, store, or share:

- Websites you visit, apps you use, or services you access;
- DNS queries or responses;
- Connection or disconnection timestamps;
- Bandwidth used or session durations;
- Your IP address tied to any activity;
- The VPN server you connected to, tied to your identity.

Our servers are configured not to write traffic logs, and our database
schema contains no table or field capable of storing activity data. There is
nothing to hand over, sell, or leak — because it was never recorded.

## 2. What we do collect

To operate accounts and billing, we store only the minimum necessary:

**Account data**

- **Email address** — login, verification, password resets, service notices.
- **Password hash** — stored only as a PBKDF2-SHA256 hash (600,000
  iterations, per-user salt). We never see or store the plaintext password.
- **Display name** (optional) — shown in the app.
- **Email verification / password-reset tokens** — 32 random bytes, SHA-256
  hashed at rest, single-use, 30-minute expiry, deleted after use.

**Device data**

- **WireGuard public keys** for each registered device — required for your
  devices to authenticate to our servers. Public keys cannot be used to
  decrypt your traffic.
- **Coarse "last seen" day** per device (calendar day only, e.g. 20261009)
  — used to show you which devices are stale. We never store precise
  connection times.

**Subscription & payment data**

- **Subscription status** (e.g. trialing, active, past_due) and plan — so the
  app can enforce your entitlements.
- **Payment events:** the payment provider's event ID and a SHA-256 hash of
  the raw webhook payload, used to verify payments and prevent
  double-processing. The raw payload is never stored.
- We do **not** store full credit-card numbers. Card processing is handled
  by our payment provider (Stripe).

**Operational records**

- **Audit logs** of administrative actions contain only internal IDs and
  action metadata — no personal data.
- **Abuse flags** may be recorded if your account is reported for violating
  the Acceptable Use Policy (the reporter's evidence reference and our
  decision). These contain no traffic data.

## 3. What we never do with your data

- We never sell personal data.
- We never use your data for advertising or profiling.
- We never share account data with third parties except our payment
  processor (to take payment) and infrastructure providers (to host the
  service), under strict contractual limits.

## 4. Legal requests

If we receive a lawful order (subpoena, court order), we can only disclose
the minimal account records described in section 2. We have no activity
logs, browsing history, or connection records to disclose — those records
do not exist. Where legally permitted, we will notify you of requests
targeting your account.

## 5. Data retention

- **Active accounts:** account, device, and subscription data are kept while
  your account exists.
- **Deleted accounts:** deleting your account removes your profile, devices,
  keys, and tokens. Payment event hashes required for tax and accounting may
  be retained in anonymized form as required by law.
- **Backups:** encrypted backups may retain deleted data for up to 30 days
  before rolling off.

## 6. Your rights (including GDPR)

You have the right to:

- **Access** — export everything we hold about you from inside the app
  (`GET /v1/gdpr/export`) or request it from support.
- **Correction** — fix inaccurate account data (e.g. update your display
  name in the app).
- **Deletion** — delete your account and associated data from inside the app
  (`DELETE /v1/gdpr/account`, password-confirmed) or by contacting support.
- **Portability** — receive your data in a structured, machine-readable
  format.
- **Objection / restriction** — object to or restrict processing as provided
  by applicable law.

We respond to rights requests within 30 days. EU/UK users may also complain
to their local supervisory authority.

## 7. Security

We protect account data with modern practices: PBKDF2 password hashing,
short-lived signed access tokens, rotating refresh tokens with reuse
detection, encrypted admin credentials, and TLS everywhere. No system is
perfect — if you believe your account is compromised, reset your password
and revoke your devices in the app immediately, then contact support.

## 8. Children

VeilVPN is not directed at children under 16, and we do not knowingly
collect their data. If you believe a child has created an account, contact
us and we will delete it.

## 9. Changes to this policy

If we change this policy, we will update the date above and, for material
changes, notify you by email or in-app notice at least 14 days before the
change takes effect. The no-logs commitment in section 1 will never be
weakened without clear, advance notice and your right to cancel.

## 10. Contact

For privacy questions or rights requests: the contact details on the
website's contact page. In-app, you can exercise access and deletion rights
directly under account settings.
