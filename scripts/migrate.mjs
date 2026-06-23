// Applies every SQL file in db/migrations (lexical order) to the Neon database
// pointed at by DATABASE_URL. Idempotent: migrations use IF NOT EXISTS guards.
//
//   DATABASE_URL=... node scripts/migrate.mjs
//
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local into process.env (only keys not already set) so the script
// works the same as the Next.js runtime without extra flags or dependencies.
function loadEnvLocal() {
  const file = join(rootDir, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local or your shell.");
  process.exit(1);
}

const migrationsDir = join(rootDir, "db", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = neon(databaseUrl);

for (const file of files) {
  const raw = readFileSync(join(migrationsDir, file), "utf8");
  console.log(`Applying ${file}...`);
  // Strip `--` line comments first (they may contain semicolons), then split
  // into statements since Neon's HTTP driver runs one statement per call.
  const stripped = raw
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  for (const statement of stripped.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) await sql.query(trimmed);
  }
}

console.log(`Done. Applied ${files.length} migration file(s).`);
