/**
 * Minimal typings for node:sqlite (used only by the test D1 stub).
 * Declared here so `tsc --noEmit` passes without @types/node.
 */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export interface StatementSync {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }
}
