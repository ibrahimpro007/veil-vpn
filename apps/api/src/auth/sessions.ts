/**
 * Session management: short-lived EdDSA access JWTs + rotating opaque
 * refresh tokens with family-based reuse detection.
 *
 * Reuse detection: every refresh rotates (old token revoked, new token in the
 * same family). If a revoked token is ever presented again, the whole family
 * is revoked — a stolen refresh token becomes useless the moment the
 * legitimate client refreshes once more.
 */
import type { AuthTokens } from "@veil/shared";
import type { Env } from "../env.js";
import { accessTokenTtl, refreshTokenTtl, jwtIssuer } from "../env.js";
import type { Db } from "../db/index.js";
import {
  storeRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeFamily,
} from "../db/queries.js";
import {
  sha256Hex,
  randomToken,
  signJwtEdDSA,
  newId,
  nowSec,
} from "../util/crypto.js";

export async function issueSession(
  db: Db,
  env: Env,
  userId: string,
): Promise<AuthTokens> {
  return issueSessionInFamily(db, env, userId, newId());
}

async function issueSessionInFamily(
  db: Db,
  env: Env,
  userId: string,
  familyId: string,
): Promise<AuthTokens> {
  const now = nowSec();
  const accessToken = await signJwtEdDSA(
    {
      sub: userId,
      iss: jwtIssuer(env),
      iat: now,
      exp: now + accessTokenTtl(env),
      typ: "access",
    },
    env.JWT_EDDSA_PRIVATE_KEY,
  );
  const refreshToken = randomToken(32);
  await storeRefreshToken(db, {
    id: newId(),
    userId,
    tokenHash: await sha256Hex(refreshToken),
    familyId,
    expiresAt: now + refreshTokenTtl(env),
  });
  return { accessToken, refreshToken, expiresIn: accessTokenTtl(env) };
}

export type RefreshResult =
  | { ok: true; tokens: AuthTokens }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

export async function rotateRefresh(
  db: Db,
  env: Env,
  presented: string,
): Promise<RefreshResult> {
  const row = await findRefreshTokenByHash(db, await sha256Hex(presented));
  if (!row) return { ok: false, reason: "invalid" };
  const now = nowSec();
  if (row.revokedAt != null) {
    // A revoked token was presented again: possible theft. Revoke the
    // entire family and force re-authentication everywhere.
    await revokeFamily(db, row.familyId, now);
    return { ok: false, reason: "reused" };
  }
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  await revokeRefreshToken(db, row.id, now);
  const tokens = await issueSessionInFamily(db, env, row.userId, row.familyId);
  return { ok: true, tokens };
}
