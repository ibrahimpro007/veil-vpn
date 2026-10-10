import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

/** Drizzle D1 database instance (typed against the schema above). */
export type Db = ReturnType<typeof makeDb>;

export function makeDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { schema };
