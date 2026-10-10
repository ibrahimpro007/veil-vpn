/**
 * Minimal typings for node builtins used by the test helpers.
 * Declared here so `tsc --noEmit` passes without @types/node (which would
 * clash with @cloudflare/workers-types globals).
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Uint8Array;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  readonly url: string;
}
