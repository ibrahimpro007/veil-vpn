#!/usr/bin/env node
/**
 * VeilVPN admin bootstrap — creates the FIRST admin user.
 *
 * The first admin is never seeded from checked-in SQL (secrets must not live
 * in the repo). Run this interactively on your own machine:
 *
 *   ADMIN_TOTP_ENC_KEY="$(openssl rand -base64 32)" node scripts/bootstrap-admin.mjs \
 *     --email admin@example.com --role owner
 *
 * It prompts for a password (min 12 chars), then prints:
 *   1. an otpauth:// URL — scan it into your authenticator app NOW
 *      (the TOTP secret is AES-256-GCM encrypted in the SQL below),
 *   2. a SQL INSERT to run via:
 *        wrangler d1 execute veil-vpn-db --file=/tmp/veil-admin.sql
 *
 * Password hashing uses the exact same PBKDF2-SHA256/600k format as the API
 * (see src/util/crypto.ts), implemented here with node:crypto.
 */
import { createInterface } from "node:readline";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function ask(rl, q, hidden) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    const stdin = process.stdin;
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "\u0004") {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write("\n");
        resolve(line);
      } else if (s === "\u0003") {
        process.exit(1);
      } else if (s === "\u007f") {
        line = line.slice(0, -1);
      } else {
        line += s;
      }
    };
    let line = "";
    process.stdout.write(q);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .map((a) => {
        const m = /^--([^=]+)=(.*)$/.exec(a) || /^--([^=]+)$/.exec(a);
        return m ? [m[1], m[2] ?? ""] : [];
      })
      .filter((x) => x.length),
  );
  const email = (args.email || "").trim().toLowerCase();
  const role = (args.role || "owner").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(
      "usage: node scripts/bootstrap-admin.mjs --email admin@example.com [--role owner|support|read-only]",
    );
    process.exit(1);
  }
  if (!["owner", "support", "read-only"].includes(role)) {
    console.error("role must be owner, support, or read-only");
    process.exit(1);
  }
  const encKeyB64 = process.env.ADMIN_TOTP_ENC_KEY || "";
  const encKey = Buffer.from(
    encKeyB64.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  if (encKey.length !== 32) {
    console.error(
      "ADMIN_TOTP_ENC_KEY must be set to 32 random bytes (base64). Generate: openssl rand -base64 32",
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await ask(rl, "New admin password (min 12 chars): ", true);
  rl.close();
  if (password.length < 12) {
    console.error("password must be at least 12 characters");
    process.exit(1);
  }

  // PBKDF2-SHA256, 600k iterations — same format as the API.
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
  const passwordHash = `$pbkdf2-sha256$600000$${b64url(salt)}$${b64url(hash)}`;

  // TOTP secret (160-bit, base32), AES-256-GCM encrypted.
  const totpSecret = base32Encode(randomBytes(20));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const ct = Buffer.concat([
    cipher.update(totpSecret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const totpSecretEncrypted = b64url(Buffer.concat([iv, ct]));

  const id = randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO admin_users (id, email, password_hash, role, totp_secret_encrypted, status, created_at, updated_at)
VALUES ('${id}', '${email.replace(/'/g, "''")}', '${passwordHash}', '${role}', '${totpSecretEncrypted}', 'active', ${now}, ${now});`;

  const otpauth = `otpauth://totp/${encodeURIComponent("VeilVPN Admin")}:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=${encodeURIComponent("VeilVPN Admin")}&digits=6&period=30&algorithm=SHA1`;

  console.log("\n=== 1. SCAN THIS INTO YOUR AUTHENTICATOR APP NOW ===");
  console.log(otpauth);
  console.log(
    "\n(The secret below is the encrypted form — the raw secret above is shown only once.)",
  );
  console.log(
    "\n=== 2. RUN THIS SQL (wrangler d1 execute veil-vpn-db --file=...) ===",
  );
  console.log(sql);
  console.log(
    "\nThen log in at the admin console: POST /admin/auth/login, then /admin/auth/totp-verify.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
