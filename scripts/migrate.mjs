// Applies every SQL file in db/migrations (lexical order) to the Neon database
// pointed at by DATABASE_URL. Idempotent: migrations use IF NOT EXISTS guards.
//
//   DATABASE_URL=... node scripts/migrate.mjs
//
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local or your shell.");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = neon(databaseUrl);

for (const file of files) {
  const statements = readFileSync(join(migrationsDir, file), "utf8");
  console.log(`Applying ${file}...`);
  // Neon's HTTP driver runs one statement per call, so split on ";".
  for (const statement of statements.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) await sql.query(trimmed);
  }
}

console.log(`Done. Applied ${files.length} migration file(s).`);
