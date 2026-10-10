import { describe, it, expect, beforeEach } from "vitest";
import { makeTestContext, type TestContext } from "./helpers.js";
import {
  appendAudit,
  verifyAuditChain,
  canonicalJson,
} from "../src/admin/audit.js";
import { createAdmin, createUser } from "../src/db/queries.js";
import { hashPassword, aesGcmEncrypt } from "../src/util/crypto.js";
import { newTotpSecret } from "../src/util/totp.js";
import { auditLogs } from "../src/db/schema.js";

let ctx: TestContext;
let adminId: string;
let userId: string;
beforeEach(async () => {
  ctx = await makeTestContext();
  // audit_logs.actor_admin_id / actor_user_id are real FKs — create the rows.
  const admin = await createAdmin(ctx.db, {
    email: "admin@example.com",
    passwordHash: await hashPassword("correct-horse-12"),
    role: "owner",
    totpSecretEncrypted: await aesGcmEncrypt(
      ctx.env.ADMIN_TOTP_ENC_KEY,
      newTotpSecret(),
    ),
  });
  adminId = admin.id;
  const user = await createUser(ctx.db, {
    email: "u@example.com",
    passwordHash: await hashPassword("correct-horse-12"),
  });
  userId = user.id;
});

describe("audit hash chain", () => {
  it("appends entries linked by hash and verifies cleanly", async () => {
    await appendAudit(ctx.db, {
      actorAdminId: adminId,
      action: "admin.user_ban",
      entity: "user",
      entityId: "u1",
      detail: JSON.stringify({ reason: "spam" }),
    });
    await appendAudit(ctx.db, {
      actorAdminId: adminId,
      action: "admin.grant",
      entity: "subscription",
      entityId: "s1",
    });
    await appendAudit(ctx.db, {
      actorUserId: userId,
      action: "user.gdpr_delete",
      entity: "user",
      entityId: userId,
    });

    const res = await verifyAuditChain(ctx.db);
    expect(res.valid).toBe(true);
    expect(res.checked).toBe(3);
    expect(res.brokenAtId).toBeNull();

    // Each row's prevHash links to the previous row's hash.
    const rows = await ctx.db.select().from(auditLogs);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);
    expect(rows[0].prevHash).not.toBe("GENESIS".toLowerCase());
  });

  it("detects a tampered hash", async () => {
    await appendAudit(ctx.db, { action: "a1", entity: "e" });
    await appendAudit(ctx.db, { action: "a2", entity: "e" });
    await appendAudit(ctx.db, { action: "a3", entity: "e" });

    const rows = await ctx.db.select().from(auditLogs);
    const target = rows[1];
    await (ctx.d1 as unknown as D1Database)
      .prepare("UPDATE audit_logs SET hash = '00tampered' WHERE id = ?1")
      .bind(target.id)
      .run();

    const res = await verifyAuditChain(ctx.db);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe(target.id);
  });

  it("detects a broken prev_hash link", async () => {
    await appendAudit(ctx.db, { action: "a1", entity: "e" });
    await appendAudit(ctx.db, { action: "a2", entity: "e" });
    const rows = await ctx.db.select().from(auditLogs);
    await (ctx.d1 as unknown as D1Database)
      .prepare("UPDATE audit_logs SET prev_hash = 'deadbeef' WHERE id = ?1")
      .bind(rows[1].id)
      .run();
    const res = await verifyAuditChain(ctx.db);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe(rows[1].id);
  });

  it("canonicalJson is key-order independent", () => {
    const a = canonicalJson({ z: 1, a: { d: 4, c: 3 }, m: [3, 2] });
    const b = canonicalJson({ m: [3, 2], a: { c: 3, d: 4 }, z: 1 });
    expect(a).toBe(b);
  });
});
