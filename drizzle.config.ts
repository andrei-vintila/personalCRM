import { defineConfig } from "drizzle-kit";

// Migrations are plain SQLite SQL, applied by:
//   - Node / VM: automatically on server start (drizzle-orm libsql migrator)
//   - Cloudflare: `wrangler d1 migrations apply DB` (reads migrations_dir in wrangler.jsonc)
export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/prm.db",
  },
});
