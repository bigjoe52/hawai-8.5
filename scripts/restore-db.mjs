#!/usr/bin/env node
/**
 * Put a backup back.
 *
 * This REPLACES everything currently in the four league tables. It is the
 * button you press after something has already gone wrong, so it refuses to
 * do anything until you have said out loud which file and confirmed:
 *
 *   node scripts/restore-db.mjs backups/2026-09-01.json           # dry run
 *   node scripts/restore-db.mjs backups/2026-09-01.json --confirm # do it
 *
 * The whole thing runs in one transaction. A failure part-way leaves the
 * database exactly as it was rather than half-restored.
 */
import { readFileSync } from "node:fs";
import { loadEnv } from "./load-env.mjs";
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";

loadEnv();

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--confirm");

if (!file) {
  console.error(`
Usage: node scripts/restore-db.mjs <backup.json> [--confirm]

Without --confirm it tells you what it would do and changes nothing.
`);
  process.exit(1);
}

/** Parents first, so foreign keys resolve as we go. */
const TABLES = ["users", "parlays", "parlay_legs", "side_bets"];

let dump;
try {
  dump = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`\nCould not read ${file}: ${err.message}\n`);
  process.exit(1);
}

if (dump.format !== 1 || !dump.tables) {
  console.error(`\n${file} does not look like a backup from this app.\n`);
  process.exit(1);
}

const resolved = resolveDatabaseUrl();
if (!resolved) {
  console.error(`\n${missingUrlMessage()}\n`);
  process.exit(1);
}

const { sql, client } = await connect(resolved.url);

try {
  console.log(`\nBackup taken ${dump.takenAt}`);
  console.log("");
  for (const table of TABLES) {
    const incoming = dump.tables[table]?.rows.length ?? 0;
    const current = (await client.query(`SELECT count(*)::int AS c FROM ${table}`)).rows[0].c;
    console.log(
      `  ${table.padEnd(12)} ${String(current).padStart(5)} now  ->  ${String(incoming).padStart(5)} from the backup`,
    );
  }

  if (!confirmed) {
    console.log(`
Nothing changed. This was a dry run.
Re-run with --confirm to replace the rows above with the backup's.
`);
    process.exit(0);
  }

  await client.query("BEGIN");

  // One TRUNCATE for all four, so the foreign keys between them never see a
  // half-empty database.
  await client.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);

  for (const table of TABLES) {
    const { columns, rows } = dump.tables[table];
    if (rows.length === 0) continue;

    // Only restore columns the database still has. A backup taken before a
    // migration dropped a column should still load.
    const live = new Set(
      (
        await sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}
        `
      ).map((c) => c.column_name),
    );
    const cols = columns.filter((c) => live.has(c));
    const dropped = columns.filter((c) => !live.has(c));
    if (dropped.length) {
      console.log(`  note: ${table} no longer has ${dropped.join(", ")} — skipping those`);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const text = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
    for (const row of rows) {
      await client.query(text, cols.map((c) => row[c] ?? null));
    }

    // The ids came from the backup, so the sequence has to be moved past them
    // or the next insert collides with a restored row.
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                     GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
    );
    console.log(`  restored ${rows.length} into ${table}`);
  }

  await client.query("COMMIT");
  console.log("\nDone. The league is back to how it looked in that backup.\n");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nRestore failed, nothing was changed: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
