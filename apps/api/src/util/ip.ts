/**
 * IPv4 CIDR math + deterministic first-free-host IP allocation for VPN nodes.
 * Pure functions — no I/O — so they are unit-testable in isolation.
 */

/** Parse "a.b.c.d" into an unsigned 32-bit integer. Throws on invalid input. */
export function ipToInt(ip: string): number {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${ip}`);
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`invalid IPv4 address: ${ip}`);
    const v = parseInt(p, 10);
    if (v < 0 || v > 255) throw new Error(`invalid IPv4 address: ${ip}`);
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  const v = n >>> 0;
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

export interface ParsedCidr {
  cidr: string;
  prefix: number;
  network: number;
  broadcast: number;
  /** Number of usable host addresses (excludes network + broadcast). */
  hostCount: number;
}

/** Parse an IPv4 CIDR like "10.7.0.0/24". Throws on invalid input. */
export function parseCidr(cidr: string): ParsedCidr {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) throw new Error(`invalid IPv4 CIDR: ${cidr}`);
  const prefix = parseInt(m[2], 10);
  if (prefix < 0 || prefix > 32)
    throw new Error(`invalid IPv4 CIDR prefix: ${cidr}`);
  const base = ipToInt(m[1]);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hostCount = Math.max(0, broadcast - network - 1);
  return {
    cidr: `${intToIp(network)}/${prefix}`,
    prefix,
    network,
    broadcast,
    hostCount,
  };
}

/**
 * Find the first free host IP in `cidr`, skipping network/broadcast and any
 * address present in `usedIps`. Returns null when the pool is exhausted —
 * the caller turns that into a clean 503 (node_full), never an exception
 * the client can't act on.
 */
export function allocateIp(
  cidr: string,
  usedIps: Iterable<string>,
): string | null {
  const { network, broadcast } = parseCidr(cidr);
  const used = new Set<number>();
  for (const ip of usedIps) {
    try {
      used.add(ipToInt(ip));
    } catch {
      // Ignore malformed entries rather than failing the whole allocation.
    }
  }
  for (let n = network + 1; n < broadcast; n++) {
    if (!used.has(n >>> 0)) return intToIp(n);
  }
  return null;
}
