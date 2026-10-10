# VeilVPN — Build Report (Phase 7 completion)

**Date:** 2026-10-09
**Scope:** finish VeilVPN — CI/CD workflows, root docs, env audit, API gap
fix (`POST /admin/nodes`), full verification sweep.

## What was done

### 1. GitHub Actions workflows (`.github/workflows/`)

- **`ci.yml`** — on push/PR: pnpm install (frozen lockfile), `turbo run
typecheck`, `turbo run lint`, `turbo run build`, `turbo run test`
  (vitest), `bash -n` on all infra shell scripts; separate jobs for
  `go vet` + `go test` (apps/node-agent) and Flutter analyze/test with a
  graceful skip + notice when Flutter isn't on the runner.
- **`release.yml`** — on tag `v*`: three build jobs (windows-latest,
  ubuntu-latest, macos-latest) then a publish job.
  - Windows: `flutter build windows --release` (FLAVOR=direct), helper via
    `dart compile exe`, Inno Setup installer from
    `apps/client/tool/veil_setup.iss` (new file), self-signed PFX generated
    in-workflow, signed with `signtool`. **SmartScreen will warn** —
    documented in the workflow and release notes.
  - Android: keystore decoded from `ANDROID_KEYSTORE_*` secrets into
    `android/key.properties`, `flutter build apk --release --flavor direct`
    (new `direct`/`play` product flavors + release signing config added to
    `android/app/build.gradle` — `--flavor direct` previously had no
    matching flavor and would have failed).
  - macOS: `flutter build macos --release`, ad-hoc `codesign -s -`, DMG via
    `hdiutil`. **Notarization skipped** ($99/yr Apple Developer) —
    Gatekeeper will warn; documented.
  - Publishes all artifacts + `SHA256SUMS.txt` to the GitHub Release.
- **`security.yml`** — weekly + on-demand: pnpm audit, gitleaks secret scan,
  govulncheck (latest), dependency-review on PRs.

### 2. Root docs (all complete, no placeholders)

- `README.md` — overview, ASCII architecture, repo layout, pinned
  assumptions, quickstart, doc links.
- `COSTS.md` — every service with free-tier allowances; paid steps marked
  SKIPPED; total unavoidable cost **$0**.
- `SECURITY.md` — threat model, crypto choices (PBKDF2-600k rationale,
  Ed25519 JWTs, HMAC control plane), OWASP ASVS L2 mapping, abuse handling,
  incident runbook (key/node/DB-leak/webhook-replay), disclosure via the
  website contact page.
- `PRIVACY_POLICY.md`, `TERMS.md`, `ACCEPTABLE_USE.md` — full legal
  templates consistent with the no-logs schema.
- `docs/DEPLOYMENT.md` — exact copy-paste deploy steps (D1+KV, secrets,
  Worker deploy, 2 Vercel projects, Oracle VM, node registration, Stripe +
  LemonSqueezy webhooks with event lists, admin bootstrap, smoke test,
  rollback incl. D1 forward-fix-only policy).
- `docs/LEAK_TESTS.md` — real-device checklist (DNS/IPv6/WebRTC, kill
  switch, reconnect storm, captive portal, reboot) with sign-off table.
- `docs/LOAD_TEST.md` + `docs/k6-staging.js` — free-tier limits and a real
  runnable k6 script (staging only).
- `apps/client/tool/veil_setup.iss` — Inno Setup installer script.

### 3. Real gap fixed: `POST /admin/nodes`

The admin console UI already called `POST /admin/nodes` ("Register node")
but the API never implemented it — the button was dead. Implemented:

- `insertNode()` in `apps/api/src/db/queries.ts` (new nodes start
  **disabled**; an owner enables them after verifying the bootstrap output).
- `POST /admin/nodes` (owner-only) in `apps/api/src/admin/routes.ts`,
  with hash-chained audit row `admin.node_register`.
- OpenAPI entry in `packages/shared/src/openapi.yaml` (spec stays in sync
  per Phase 1 contracts).
- New vitest case (RBAC deny for support, 400 on bad endpoint, 201 →
  disabled → invisible on `/v1/nodes` → PATCH active → visible, audit row
  written).

### 4. Env audit (`.env.example` fixes)

- `apps/api/.env.example`: added missing `JWT_ISSUER` (declared in
  `env.ts`, default `veil-api`).
- `apps/node-agent/.env.example`: added missing `NOTIFY_SOCKET` (read in
  `notify.go`, set by systemd).
- Verified: admin, site, client examples cover every var their code reads.

### 5. Scripts

- Root `package.json`: added `test:all` (turbo test + Go tests when Go is
  present).
- Fixed broken `lint` scripts so `turbo run lint` is real everywhere:
  `packages/shared` called a non-installed `eslint` (failed); `apps/admin`
  used `next lint` (would hang CI without an eslint config). All four JS
  packages now run `prettier --check` on their sources; ran `pnpm format`
  so the tree is clean.

## Verification results

| Check                                   | Result                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| `tsc --noEmit` packages/shared          | ✅ pass                                                           |
| `tsc --noEmit` apps/api                 | ✅ pass                                                           |
| `tsc --noEmit` apps/admin               | ✅ pass                                                           |
| `tsc --noEmit` apps/site                | ✅ pass                                                           |
| `turbo run build` (shared, admin, site) | ✅ pass                                                           |
| `turbo run lint` (4 packages)           | ✅ pass                                                           |
| `turbo run typecheck` (4 packages)      | ✅ pass                                                           |
| vitest apps/api                         | ✅ **58/58 pass** (was 57; +1 new node-registration test)         |
| `go vet ./...` apps/node-agent          | ✅ clean                                                          |
| `go test ./...` apps/node-agent         | ✅ pass (61 test runs, 0 failures)                                |
| `bash -n` infra/scripts + cloud-init    | ✅ pass                                                           |
| Flutter                                 | ⚠️ not installed on this VM — CI job skips gracefully with notice |

## File counts

- **Total files in repo (excl. node_modules/.git):** 627
- **Source files (excl. node_modules, .next, dist, build):** 284
- Per app (source): api 62 · admin 196 · client 58 · node-agent 20 ·
  site 204 · shared 23 · infra 10 · .github 3 · docs 4

## Honest limitations

1. **Tunnel adapters need real-device testing.** The Windows helper, Android
   (WireGuard tunnel lib), and macOS (PacketTunnel extension) code paths
   have never run on real hardware from this build. `docs/LEAK_TESTS.md`
   must pass on each platform before any release ships.
2. **Signing is self-signed / ad-hoc.** Windows SmartScreen will warn
   ("Unknown publisher"); macOS Gatekeeper will warn (no notarization).
   CA/EV certificates are deliberately SKIPPED on the $0 budget.
3. **Bootstrap never executed on a real Oracle VM.** `node-bootstrap.sh`
   and the cloud-init flow are written and syntax-checked only; the first
   real run may surface environment issues.
4. **Stripe is in test mode** and LemonSqueezy in sandbox; no live payment
   has been processed. Play/StoreKit webhook code is implemented but
   dormant (store flavors compile; billing inactive without store accounts).
5. **Resend free tier** caps at 100 emails/day — fine for verification and
   resets at small scale, not for growth.
6. **Single Oracle region, one Always Free VM** (4 OCPU/24 GB uses the whole
   Ampere allowance) — no redundancy; a second node needs another tenancy.
7. **No independent security audit** has been performed; the ASVS mapping
   in SECURITY.md is self-assessed.
8. **Flutter client never compiled here** (no Flutter SDK on this VM); the
   release workflow installs it on runners. The macOS PacketTunnel target
   additionally needs the manual Xcode wiring in `apps/client/macos/README.md`.
9. **Divergence noted:** the site's privacy page says passwords are stored
   as "Argon2id" hashes, but the implemented (and documented in
   PHASE23_NOTES.md) scheme is **PBKDF2-SHA256/600k** — the root
   PRIVACY_POLICY.md uses the accurate PBKDF2 wording. The site page should
   be updated to match.
