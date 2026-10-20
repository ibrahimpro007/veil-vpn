/**
 * Worker environment: bindings + secrets.
 * Every name matches apps/api/.env.example exactly — do not rename without
 * updating .env.example, infra/wrangler.toml docs, and PHASE1_NOTES.md.
 */
export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;

  APP_NAME?: string;
  APP_ENV?: string;
  APP_URL: string;
  API_PUBLIC_URL?: string;
  ADMIN_URL?: string;
  JWT_ISSUER?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_SECONDS?: string;

  JWT_EDDSA_PRIVATE_KEY: string;
  JWT_EDDSA_PUBLIC_KEY: string;

  RESEND_API_KEY: string;
  EMAIL_FROM: string;

  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET: string;

  LEMONSQUEEZY_API_KEY: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  LEMONSQUEEZY_STORE_ID: string;

  NODE_AGENT_HMAC_SECRET: string;
  NODE_AGENT_PORT?: string;
  ADMIN_TOTP_ENC_KEY: string;
  ADMIN_LOGIN_SIMPLE?: string;
  GOOGLE_OAUTH_CLIENT_IDS?: string;
  GOOGLE_SIGNIN_ENABLED?: string;

  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  APPLE_APPSTORE_ISSUER_ID?: string;
  APPLE_APPSTORE_KEY_ID?: string;
  APPLE_APPSTORE_PRIVATE_KEY?: string;
}

export function jwtIssuer(env: Env): string {
  return env.JWT_ISSUER ?? "veil-api";
}

/** Access-token TTL, seconds. Default 900 (15 min). */
export function accessTokenTtl(env: Env): number {
  const v = parseInt(env.ACCESS_TOKEN_TTL_SECONDS ?? "900", 10);
  return Number.isFinite(v) && v > 0 ? v : 900;
}

/** Refresh-token TTL, seconds. Default 2592000 (30 days). */
export function refreshTokenTtl(env: Env): number {
  const v = parseInt(env.REFRESH_TOKEN_TTL_SECONDS ?? "2592000", 10);
  return Number.isFinite(v) && v > 0 ? v : 2592000;
}

/** Strict CORS allowlist: only our own front-ends. */
export function corsOrigins(env: Env): string[] {
  return [env.APP_URL, env.ADMIN_URL, env.API_PUBLIC_URL].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}
