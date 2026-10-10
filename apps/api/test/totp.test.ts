import { describe, it, expect } from "vitest";
import {
  totpCode,
  verifyTotp,
  base32Decode,
  base32Encode,
  newTotpSecret,
} from "../src/util/totp.js";

/**
 * RFC 6238 Appendix B test vectors (SHA-1, 30s step, 8 digits).
 * Secret is the ASCII string "12345678901234567890".
 */
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 SHA-1 test vectors", async () => {
    for (const [t, expected] of VECTORS) {
      const code = await totpCode(RFC_SECRET_B32, { digits: 8, atSec: t });
      expect(code).toBe(expected);
    }
  });

  it("verifies a current code and rejects wrong ones", async () => {
    const code = await totpCode(RFC_SECRET_B32, {
      digits: 8,
      atSec: 1234567890,
    });
    expect(
      await verifyTotp(RFC_SECRET_B32, code, { digits: 8, atSec: 1234567890 }),
    ).toBe(true);
    expect(
      await verifyTotp(RFC_SECRET_B32, "00000000", {
        digits: 8,
        atSec: 1234567890,
      }),
    ).toBe(false);
  });

  it("accepts adjacent time steps (clock skew window)", async () => {
    const code = await totpCode(RFC_SECRET_B32, { digits: 8, atSec: 59 });
    // One step later (t=60..89) still verifies with window=1.
    expect(
      await verifyTotp(RFC_SECRET_B32, code, {
        digits: 8,
        atSec: 89,
        window: 1,
      }),
    ).toBe(true);
    expect(
      await verifyTotp(RFC_SECRET_B32, code, {
        digits: 8,
        atSec: 89,
        window: 0,
      }),
    ).toBe(false);
  });

  it("round-trips base32", () => {
    const secret = newTotpSecret();
    expect(base32Encode(base32Decode(secret)).replace(/=+$/, "")).toBe(
      secret.replace(/=+$/, ""),
    );
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });
});
