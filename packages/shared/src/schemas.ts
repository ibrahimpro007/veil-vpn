import { z } from "zod";

/**
 * Shared primitive validators.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .describe("Opaque TEXT primary key (ULID/cuid2/nano-id)");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320)
  .describe("RFC email, normalized lowercase");

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256)
  .describe(
    "Minimum 12 chars; hashed server-side with Argon2id before storage",
  );

export const wireGuardPublicKeySchema = z
  .string()
  .length(44)
  .regex(/^[A-Za-z0-9+/]{43}=$/, "WireGuard public key must be 44-char base64")
  .describe("WireGuard public key, standard base64 (32 bytes)");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const platformSchema = z.enum([
  "windows",
  "android",
  "macos",
  "linux",
  "ios",
]);

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(256),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: passwordSchema,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export const updateProfileSchema = z.object({
  // The display name is the only mutable profile field (users.name,
  // added in migration 0002). Null clears it.
  name: z.string().trim().min(1).max(100).nullable(),
});

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export const deviceRegisterSchema = z.object({
  name: z.string().trim().min(1).max(100),
  platform: platformSchema,
  wgPublicKey: wireGuardPublicKeySchema,
});

export const deviceIdParamSchema = z.object({
  id: idSchema,
});

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

export const connectRequestSchema = z.object({
  deviceId: idSchema,
  nodeId: idSchema.optional(),
});

export const disconnectRequestSchema = z.object({
  deviceId: idSchema,
});

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export const checkoutCreateSchema = z.object({
  planId: idSchema,
  provider: z.enum(["stripe", "lemonsqueezy"]),
});

export const portalCreateSchema = z.object({}).strict();

export const webhookEventEnvelopeSchema = z.object({
  provider: z.enum(["stripe", "lemonsqueezy", "play", "storekit"]),
  providerEventId: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  payloadHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .describe(
      "sha256 hex of raw payload — raw payload is never stored (no-logs)",
    ),
  userId: idSchema.optional(),
  subscriptionId: idSchema.optional(),
  amountCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const adminUserCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "support", "read-only"]),
  password: passwordSchema,
});

export const adminUserSuspendSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const adminUserBanSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const adminDeviceRevokeSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const adminGrantSchema = z.object({
  userId: idSchema,
  planId: idSchema,
  days: z.number().int().min(1).max(3650),
  reason: z.string().trim().min(1).max(500),
});

export const adminNodeUpdateSchema = z.object({
  status: z.enum(["active", "draining", "disabled"]).optional(),
  capacity: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  dnsIp: z.string().ip({ version: "v4" }).optional(),
});

export const nodeRegisterSchema = z.object({
  region: z.string().trim().min(1).max(100),
  countryCode: z.string().trim().length(2).toUpperCase(),
  city: z.string().trim().min(1).max(100),
  endpoint: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/, "endpoint must be host:port"),
  wgPublicKey: wireGuardPublicKeySchema,
  capacity: z.number().int().min(1),
  ipPoolCidr: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
      "must be IPv4 CIDR like 10.7.0.0/24",
    ),
  dnsIp: z.string().ip({ version: "v4" }),
  sortOrder: z.number().int().default(0),
});

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  startsAt: z.number().int().positive().optional(),
  endsAt: z.number().int().positive().optional(),
});

export const adminUserSearchQuerySchema = z.object({
  search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const auditLogQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(100).optional(),
});

/* ------------------------------------------------------------------ */
/* Node agent (control-plane)                                          */
/* ------------------------------------------------------------------ */

export const nodeAgentAuthSchema = z.object({
  nodeId: idSchema,
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{64}$/, "hex HMAC-SHA256"),
});

export const peerSyncRequestSchema = z.object({
  nodeId: idSchema,
  desiredPeers: z.array(
    z.object({
      deviceId: idSchema,
      wgPublicKey: wireGuardPublicKeySchema,
      assignedIp: z.string().ip({ version: "v4" }),
    }),
  ),
  removedDeviceIds: z.array(idSchema),
});

/* ------------------------------------------------------------------ */
/* Inferred TS types                                                   */
/* ------------------------------------------------------------------ */

export type Id = z.infer<typeof idSchema>;
export type Email = z.infer<typeof emailSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;
export type PasswordResetConfirmInput = z.infer<
  typeof passwordResetConfirmSchema
>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;
export type ConnectRequestInput = z.infer<typeof connectRequestSchema>;
export type DisconnectRequestInput = z.infer<typeof disconnectRequestSchema>;
export type CheckoutCreateInput = z.infer<typeof checkoutCreateSchema>;
export type WebhookEventEnvelope = z.infer<typeof webhookEventEnvelopeSchema>;
export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;
export type AdminUserSuspendInput = z.infer<typeof adminUserSuspendSchema>;
export type AdminUserBanInput = z.infer<typeof adminUserBanSchema>;
export type AdminDeviceRevokeInput = z.infer<typeof adminDeviceRevokeSchema>;
export type AdminGrantInput = z.infer<typeof adminGrantSchema>;
export type AdminNodeUpdateInput = z.infer<typeof adminNodeUpdateSchema>;
export type NodeRegisterInput = z.infer<typeof nodeRegisterSchema>;
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuerySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type NodeAgentAuth = z.infer<typeof nodeAgentAuthSchema>;
export type PeerSyncRequest = z.infer<typeof peerSyncRequestSchema>;
