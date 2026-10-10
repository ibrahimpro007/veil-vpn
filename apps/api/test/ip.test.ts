import { describe, it, expect } from "vitest";
import { ipToInt, intToIp, parseCidr, allocateIp } from "../src/util/ip.js";

describe("ipToInt / intToIp", () => {
  it("round-trips IPv4 addresses", () => {
    expect(ipToInt("10.7.0.1")).toBe(168230913);
    expect(intToIp(168230913)).toBe("10.7.0.1");
    expect(intToIp(ipToInt("255.255.255.255"))).toBe("255.255.255.255");
    expect(intToIp(ipToInt("0.0.0.0"))).toBe("0.0.0.0");
  });

  it("rejects invalid input", () => {
    expect(() => ipToInt("999.1.1.1")).toThrow();
    expect(() => ipToInt("10.7.0")).toThrow();
    expect(() => ipToInt("abc")).toThrow();
  });
});

describe("parseCidr", () => {
  it("computes network and broadcast", () => {
    const c = parseCidr("10.7.3.0/24");
    expect(intToIp(c.network)).toBe("10.7.3.0");
    expect(intToIp(c.broadcast)).toBe("10.7.3.255");
    expect(c.hostCount).toBe(254);
  });

  it("rejects invalid CIDRs", () => {
    expect(() => parseCidr("10.7.0.0/33")).toThrow();
    expect(() => parseCidr("not-a-cidr")).toThrow();
  });
});

describe("allocateIp", () => {
  it("allocates the first free host IP, skipping network/broadcast", () => {
    expect(allocateIp("10.7.0.0/24", [])).toBe("10.7.0.1");
    expect(allocateIp("10.7.0.0/24", ["10.7.0.1"])).toBe("10.7.0.2");
    expect(
      allocateIp("10.7.0.0/24", ["10.7.0.1", "10.7.0.2", "10.7.0.5"]),
    ).toBe("10.7.0.3");
  });

  it("exhausts a /30 pool cleanly (only .1 and .2 usable)", () => {
    // 10.0.0.4/30 → network .4, hosts .5/.6, broadcast .7
    expect(allocateIp("10.0.0.4/30", [])).toBe("10.0.0.5");
    expect(allocateIp("10.0.0.4/30", ["10.0.0.5"])).toBe("10.0.0.6");
    expect(allocateIp("10.0.0.4/30", ["10.0.0.5", "10.0.0.6"])).toBeNull();
  });

  it("returns null for a /32 with no usable hosts", () => {
    expect(allocateIp("10.0.0.1/32", [])).toBeNull();
  });

  it("ignores malformed used-IP entries", () => {
    expect(allocateIp("10.7.0.0/24", ["garbage", "10.7.0.1"])).toBe("10.7.0.2");
  });
});
