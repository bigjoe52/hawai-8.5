#!/usr/bin/env node
/**
 * Answer one question clearly: can this machine reach the database?
 *
 *   npm run db:check
 *
 * Run this before db:setup. A connection problem here produces a plain
 * explanation instead of a stack trace three steps later.
 */
import { loadEnv } from "./load-env.mjs";
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";

loadEnv();

const resolved = resolveDatabaseUrl();
if (!resolved) {
  console.error(`\n${missingUrlMessage()}\n`);
  process.exit(1);
}

// Show the host but never the password.
let where = "(unparseable URL)";
try {
  const u = new URL(resolved.url);
  where = `${u.hostname}${u.pathname}`;
} catch {
  /* fall through -- the connection attempt will produce the real error */
}

console.log(`\nConnection string : ${resolved.source}`);
console.log(`Host              : ${where}`);
console.log(`Pooled            : ${resolved.isPooled ? "yes" : "no (see README)"}`);

let client;
try {
  ({ client } = await connect(resolved.url));
} catch (err) {
  console.error("\nCould not connect.\n");
  const m = err.message ?? String(err);

  if (/ENOTFOUND|EAI_AGAIN/.test(m)) {
    console.error(`  The host "${where.split("/")[0]}" does not resolve.`);
    console.error("  Usually a placeholder or a typo in the connection string.");
  } else if (/password authentication failed/i.test(m)) {
    console.error("  The username or password in the connection string is wrong.");
    console.error("  Copy it again from the dashboard -- they are long and easy to truncate.");
  } else if (/does not exist/i.test(m)) {
    console.error("  That database name does not exist on the server.");
  } else if (/ETIMEDOUT|ECONNREFUSED/.test(m)) {
    console.error("  Nothing answered at that host and port.");
    console.error("  If the database is local, is it running?");
  } else if (/self.signed|certificate/i.test(m)) {
    console.error("  TLS problem reaching the database.");
  } else {
    console.error(`  ${m}`);
  }
  console.error("");
  process.exit(1);
}

const [{ version }] = await client.query("SELECT version()").then((r) => r.rows);
console.log(`Server            : ${version.split(" ").slice(0, 2).join(" ")}`);

const { rows } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('users','parlays','parlay_legs','side_bets')
  ORDER BY table_name
`);

if (rows.length === 0) {
  console.log("Tables            : none yet\n");
  console.log("Connected fine. Next:  npm run db:setup\n");
} else if (rows.length < 4) {
  console.log(`Tables            : ${rows.map((r) => r.table_name).join(", ")}`);
  console.log("\nSome tables are missing. Run:  npm run db:setup\n");
} else {
  const [{ count }] = await client
    .query("SELECT count(*)::int AS count FROM users")
    .then((r) => r.rows);
  console.log("Tables            : all four present");
  console.log(`Accounts          : ${count}`);
  console.log(
    count === 0
      ? "\nConnected fine. Next:  npm run db:seed\n"
      : "\nEverything is set up. Nothing to do.\n",
  );
}

await client.end();
