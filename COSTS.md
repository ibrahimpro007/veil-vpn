# VeilVPN — Cost Breakdown ($0 budget)

Every service VeilVPN depends on, what the free tier gives us, and what the
paid step costs (marked **SKIPPED** where we deliberately do not pay).

| Service                                  | What we use it for                            | Free tier / allowance                                     | Paid cost                | Status                                              |
| ---------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| Cloudflare Workers                       | API (`veil-api`)                              | 100,000 requests/day                                      | $5/mo for 10M req beyond | Free                                                |
| Cloudflare D1                            | Primary database (`veil-vpn-db`)              | 5 GB storage, 5M rows read/day, 100k rows written/day     | $0.75/M extra reads      | Free                                                |
| Cloudflare KV                            | Rate-limit buckets (`RATE_LIMIT`)             | 100k reads/day, 1k writes/day, 1 GB                       | overage per 1M ops       | Free                                                |
| Vercel                                   | 2 projects: admin console + marketing site    | 100 GB bandwidth/mo, 6k build min/mo (Hobby)              | $20/mo Pro               | Free                                                |
| GitHub Actions                           | CI, release builds, security scans            | 2,000 min/mo (public repo: unlimited)                     | $0.008/min beyond        | Free                                                |
| Oracle Cloud Always Free                 | VPN node VMs                                  | 4 ARM OCPU + 24 GB RAM + 200 GB boot volume (per tenancy) | n/a                      | Free                                                |
| Resend                                   | Verification / password-reset / notice emails | 100 emails/day, 3,000/mo                                  | $20/mo beyond            | Free                                                |
| Stripe                                   | Card billing (web checkout)                   | **Test mode is free.** Live: 2.9% + 30¢ per transaction   | per-transaction          | Test mode (live = future)                           |
| LemonSqueezy                             | Alternative billing provider                  | Sandbox free; live takes a revenue share                  | revenue share            | Sandbox                                             |
| Google Play                              | Android store listing                         | —                                                         | $25 one-time             | **SKIPPED** — direct APK via GitHub Releases        |
| Apple Developer Program                  | macOS notarization + App Store                | —                                                         | $99/year                 | **SKIPPED** — ad-hoc signed DMG via GitHub Releases |
| Code-signing certificate (Windows EV/OV) | SmartScreen reputation                        | —                                                         | ~$200–500/year           | **SKIPPED** — self-signed in CI (SmartScreen warns) |

## Total unavoidable cost: **$0 / month**

Notes:

- The repo is expected to be **public**, which makes GitHub Actions minutes
  effectively unlimited for CI/release/security workflows.
- One Oracle Always Free ARM VM (4 OCPU / 24 GB) uses the entire Ampere
  allowance for a tenancy — a second node needs a second tenancy (still
  free) or a paid shape.
- Resend's 100/day cap covers verification + password-reset + announcement
  emails for a small user base; growth beyond that needs a paid email tier.
- Stripe live mode and any real card processing are deliberately deferred;
  checkout code paths are exercised in test mode only.
- No paid store steps exist in any workflow: `release.yml` builds and signs
  everything on free runners and publishes to GitHub Releases.
