/**
 * @veil/shared — shared contracts for VeilVPN.
 *
 * Re-exports every Zod schema (and inferred types) plus shared TS types.
 * The OpenAPI 3.1 spec lives at src/openapi.yaml and is copied to
 * dist/openapi.yaml on build (see the copy-openapi script).
 */
export * from "./schemas.js";
export * from "./types.js";
