#!/usr/bin/env node
/**
 * Create the database tables. Safe to run more than once -- every statement
 * is CREATE TABLE IF NOT EXISTS, so re-running it changes nothing.
 *
 *   npm run db:setup
 */
import { readFile } from "node:fs/promises";
import { connect } from "./db-connect.mjs";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\nDATABASE_URL is not set.\n\n" +
      "  On Vercel: add a Postgres store to the project, then run\n" +
      "    vercel env pull .env.local\n" +
      "  Locally: copy .env.example to .env.local and fill it in.\n",
  );
  process.exit(1);
}

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

await client.end();
console.log("\nDatabase ready. Now run:  npm run db:seed\n");
