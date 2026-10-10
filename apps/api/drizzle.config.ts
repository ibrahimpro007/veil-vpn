import { defineConfig } from "drizzle-kit";

// Generates D1/SQLite migrations from src/db/schema.ts.
// New migrations land in infra/d1/migrations (0001_init.sql is hand-written).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "../../infra/d1/migrations",
  dialect: "sqlite",
  verbose: true,
});
