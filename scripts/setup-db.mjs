#!/usr/bin/env node
/**
 * Create the database tables. Safe to run more than once -- every statement
 * is CREATE TABLE IF NOT EXISTS, so re-running it changes nothing.
 *
 *   npm run db:setup
 */
import { readFile, readdir } from "node:fs/promises";
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const resolved = resolveDatabaseUrl();
if (!resolved) {
  console.error(`\n${missingUrlMessage()}\n`);
  process.exit(1);
}
const url = resolved.url;
console.log(`Using ${resolved.source}`);

const { client } = await connect(url);
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

// Split on semicolons at the end of a line, so semicolons inside comments
// or strings do not break the statement apart.
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--")));

console.log(`Applying ${statements.length} statements...`);
for (const statement of statements) {
  const label = statement.split("\n")[0].slice(0, 70);
  try {
    await client.query(statement);
    console.log(`  ok  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

/* --- Migrations ------------------------------------------------------------
 * Applied after the schema, each file whole rather than split into statements,
 * because a migration may contain a DO $$ ... $$ block whose internal
 * semicolons must not be treated as statement boundaries.
 */
const migrationsDir = new URL("../db/migrations/", import.meta.url);
let migrations = [];
try {
  migrations = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
} catch {
  // No migrations directory yet -- nothing to do.
}

if (migrations.length > 0) {
  console.log(`\nApplying ${migrations.length} migration(s)...`);
  for (const file of migrations) {
    const sqlText = await readFile(new URL(file, migrationsDir), "utf8");
    try {
      await client.query(sqlText);
      console.log(`  ok  ${file}`);
    } catch (err) {
      console.error(`  FAIL  ${file}`);
      console.error(`        ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }
}

await client.end();
console.log("\nDatabase ready. Now run:  npm run db:seed\n");
