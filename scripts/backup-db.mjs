#!/usr/bin/env node
/**
 * Dump the whole league to a single JSON file.
 *
 * Deliberately not pg_dump: this runs anywhere Node runs, needs no client
 * binaries whose version has to match the server's, and produces something
 * you can open and read. The league is four small tables -- the dump is a
 * few kilobytes.
 *
 *   node scripts/backup-db.mjs                # -> backups/2026-09-01.json
 *   node scripts/backup-db.mjs --out /tmp     # somewhere else
 *   node scripts/backup-db.mjs --stdout       # straight to stdout
 *
 * Columns are read from the database rather than listed here, so a migration
 * that adds a column is picked up without anyone remembering to edit this.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";

loadEnv();

// Hand back dates and times as the exact text Postgres holds, rather than
// letting node-postgres parse them into JavaScript Date objects. A Date only
// keeps milliseconds, so a timestamp stored as 21:48:37.834567 would come
// back as .834 -- a backup that quietly rounds the data it is preserving.
// 1082 date, 1114 timestamp, 1184 timestamptz, 1083 time, 1266 timetz.
for (const oid of [1082, 1114, 1184, 1083, 1266]) {
  pg.types.setTypeParser(oid, (v) => v);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

/** FK order: parents first, so a restore can replay it top to bottom. */
const TABLES = ["users", "parlays", "parlay_legs", "side_bets"];

const resolved = resolveDatabaseUrl();
if (!resolved) {
  console.error(`\n${missingUrlMessage()}\n`);
  process.exit(1);
}

/** The most recent dump already in `dir`, or null if there are none. */
function latestBackup(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
  } catch {
    return null; // Unreadable? Treat it as absent and write a fresh one.
  }
}

const { sql, client } = await connect(resolved.url);

try {
  const dump = {
    format: 1,
    takenAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of TABLES) {
    const columns = (
      await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY ordinal_position
      `
    ).map((c) => c.column_name);

    if (columns.length === 0) {
      console.error(`\nTable "${table}" is missing. Is this the right database?\n`);
      process.exit(1);
    }

    // Safe to interpolate: the name came from information_schema, not input.
    const rows = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    dump.tables[table] = { columns, rows };
  }

  const json = JSON.stringify(dump, null, 2);

  if (flag("stdout")) {
    process.stdout.write(json + "\n");
  } else {
    const dir = value("out", "backups");
    mkdirSync(dir, { recursive: true });

    // If nothing has actually changed since the last backup, leave it alone.
    // `takenAt` moves every run, so comparing whole files would call every
    // quiet week a change and fill the history with identical snapshots.
    // Only the data is compared.
    const previous = latestBackup(dir);
    if (previous && JSON.stringify(previous.tables) === JSON.stringify(dump.tables)) {
      console.log(`\nNothing has changed since ${previous.takenAt}. No new backup written.`);
      await client.end();
      process.exit(0);
    }

    // One file per day. A second run on the same day overwrites the first,
    // which is what you want: the later one is the better copy, and git still
    // has the earlier one.
    const path = join(dir, `${dump.takenAt.slice(0, 10)}.json`);
    writeFileSync(path, json + "\n");
    console.log(`\nWrote ${path}`);
  }

  const counts = TABLES.map((t) => `${dump.tables[t].rows.length} ${t}`).join(", ");
  console.error(`  ${counts}`);
} finally {
  await client.end();
}
