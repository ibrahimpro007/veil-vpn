# VeilVPN Admin Console (Phase 5)

Next.js 14 (App Router) admin console for VeilVPN, deployed to Vercel as its
own project. It is a pure frontend: every data call goes to the Worker API's
`/admin/*` routes, validated client-side with the Zod schemas in
`@veil/shared` (never hand-rolled duplicates).

## Run / develop

```bash
# from the monorepo root
pnpm install
pnpm --filter @veil/admin dev      # http://localhost:3001

# typecheck & production build
pnpm --filter @veil/admin typecheck
pnpm --filter @veil/admin build
```

The dev server talks to the Worker URL in `NEXT_PUBLIC_API_BASE_URL` — point
it at your local/dev Worker while developing.

## Environment variables

| Name                       | Required | Purpose                                                                                                                                                                            |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | yes      | Worker API base, e.g. `https://api.veil.example`. No trailing slash, no `/v1` suffix (admin routes live at `<base>/admin/…`). Name is pinned by `PHASE1_NOTES.md` — do not rename. |
| `ADMIN_SESSION_SECRET`     | reserved | Not used by the current build. Reserved for a future httpOnly-cookie session proxy.                                                                                                |
| `ADMIN_TOTP_ENC_KEY`       | api-side | Must match the API's `ADMIN_TOTP_ENC_KEY`; listed here so admins know the pairing requirement.                                                                                     |

Copy `apps/admin/.env.example` to `.env.local` for local dev. On Vercel, set
`NEXT_PUBLIC_API_BASE_URL` in the project environment variables.

## Vercel deploy steps

1. Create a new Vercel project from the monorepo.
2. **Root Directory:** `apps/admin` (per `apps/admin/vercel.json`).
3. **Framework preset:** Next.js (auto-detected).
4. **Build command:** `cd ../.. && pnpm --filter @veil/admin build`
   (already in `vercel.json`).
5. **Install command:** `cd ../.. && pnpm install` (already in `vercel.json`).
6. Set environment variable `NEXT_PUBLIC_API_BASE_URL` to the production
   Worker URL (e.g. `https://api.veil.example`).
7. Deploy. No `output: standalone` is needed on Vercel.

## Auth model

1. `/login` — email + password → `POST /admin/auth/login`.
2. If the response has `totpRequired: true`, a second screen collects the
   authenticator code → `POST /admin/auth/totp-verify` → admin session JWT.
3. The JWT is kept in JS memory with a `sessionStorage` fallback (survives
   reloads, not browser restarts) and sent as `Authorization: Bearer`.

**Tradeoff (documented):** an httpOnly cookie + Next.js `/api` proxy would
keep the token out of JS entirely (XSS-immune), at the cost of proxying
every call through Next.js and extra deployment complexity. This console
ships strict CSP, session-scoped storage, and TOTP-gated sessions; every
page treats any API `401` as signed-out and redirects to `/login` (server
403s surface as toasts with the `requestId`). `middleware.ts` only checks a
client-set `veil_admin_auth=1` marker cookie to avoid flashing protected UI
— it is a UX nicety, not a security boundary; the Worker is the authority.

## RBAC matrix

Client-side gating (`lib/auth.tsx` `can()`) hides/disables actions; the
Worker enforces everything server-side (403 → error toast with requestId).

| Capability                                                        | owner | support | read-only |
| ----------------------------------------------------------------- | ----- | ------- | --------- |
| View lists (users, subscriptions, payments, audit logs, overview) | ✅    | ✅      | ✅        |
| Suspend / unsuspend users                                         | ✅    | ✅      | ❌        |
| Ban / unban users                                                 | ✅    | ❌      | ❌        |
| Revoke devices                                                    | ✅    | ✅      | ❌        |
| Grant complimentary subscriptions                                 | ✅    | ✅      | ❌        |
| Nodes page (view, status, capacity, register)                     | ✅    | ❌      | ❌        |
| Create announcements                                              | ✅    | ✅      | ❌        |
| Delete announcements                                              | ✅    | ❌      | ❌        |
| Verify audit-log chain                                            | ✅    | ✅      | ❌        |
| Export users.csv                                                  | ✅    | ❌      | ❌        |

## First owner creation

The first admin (owner) is **not** created from this UI and never from
checked-in SQL. Use the Worker bootstrap script (Phase 2,
`apps/api`): it creates the owner row, sets the password, and prints the
TOTP secret as a QR code / `otpauth://` URI for enrollment in an
authenticator app. Afterwards, sign in at `/login`.

## Cloudflare Access (optional, free tier)

For extra protection, put the admin site's hostname behind Cloudflare
Zero Trust Access (free for up to 50 users): create an Access application
for `admin.veil.example` with an allow-policy for your admin emails. This
is defense-in-depth — the Worker still requires the TOTP-gated session JWT.

## Spec deviations (flag for the Worker / Phase 2 implementer)

These routes are called by the UI exactly like spec routes (same
`ApiError` envelope, same `adminSession` bearer scheme, `X-Request-Id`
on every request) but are **not** in `packages/shared/src/openapi.yaml`
yet — add them to the spec or implement equivalents:

- `POST /admin/auth/login` → `{ totpRequired, challengeId?, sessionToken? }`
- `POST /admin/auth/totp-verify` `{ challengeId, code }` → `{ sessionToken }`
- `POST /admin/users/:id/unsuspend` → `UserProfile`
- `POST /admin/users/:id/unban` → `UserProfile`
- `GET /admin/users/:id/devices` → `{ devices: Device[] }`
- `GET /admin/users/:id/subscription` → `{ subscription: Subscription | null }`
- `GET /admin/users/:id/payment-events?page=&pageSize=` → `Paginated<PaymentEvent>`
- `POST /admin/nodes` (body = `nodeRegisterSchema`) → `201 VpnNodeAdmin`
- `GET /admin/announcements` → `{ announcements: Announcement[] }` (all, incl. scheduled/expired)
- `DELETE /admin/announcements/:id` → `204`

Also: `Subscription` has no user link in the spec, so the Subscriptions
table cannot show the account email — consider adding `userId`/`userEmail`
to the admin subscription view. "Peers total" is intentionally not shown:
no admin endpoint exposes peer counts (privacy invariant).

## Refund deep links

Built from each event's `providerEventId` on the Payments page:

- **Stripe** → `https://dashboard.stripe.com/payments/<providerEventId>`
  (opens the payment; issue the refund there).
- **Lemon Squeezy** → `https://app.lemonsqueezy.com/orders` (no stable
  per-order deep-link format; search the event id on the orders page).
- **Play / StoreKit / comp** → no deep link; refunds happen in the
  Play Console / App Store Connect / internal tooling.

## Security headers

`next.config.js` sets CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy`, and a restrictive `Permissions-Policy` on all routes.
