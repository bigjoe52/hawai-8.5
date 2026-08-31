#!/usr/bin/env node
/**
 * Create the league's ten accounts and print their passwords ONCE.
 *
 *   npm run db:seed
 *
 * Edit the LEAGUE list below to your actual guys before running it. Existing
 * usernames are skipped, so re-running this only adds people you've added to
 * the list -- it never resets anyone's password.
 *
 * To reset one person's password:
 *   node scripts/seed-users.mjs --reset joe
 */
import { existsSync, readFileSync } from "node:fs";
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";
import { loadEnv } from "./load-env.mjs";
import { hashPassword, generatePassword } from "../src/lib/crypto.ts";

loadEnv();

// ---------------------------------------------------------------------------
// Your league lives in league.roster.json, NOT in this file.
//
// That file is gitignored, so your names are yours alone and can never be
// clobbered by an update to this script. Copy league.roster.example.json to
// league.roster.json and edit it.
//
// If no such file exists, the placeholder names below are used so a fresh
// clone still works.
// ---------------------------------------------------------------------------
const PLACEHOLDER = [
  { username: "joe", displayName: "Joe", admin: true },
  { username: "mike", displayName: "Mike" },
  { username: "dave", displayName: "Dave" },
  { username: "chris", displayName: "Chris" },
  { username: "steve", displayName: "Steve" },
  { username: "tony", displayName: "Tony" },
  { username: "nick", displayName: "Nick" },
  { username: "matt", displayName: "Matt" },
  { username: "ryan", displayName: "Ryan" },
  { username: "sean", displayName: "Sean" },
];

const LEAGUE = process.argv.includes("--placeholder")
  ? PLACEHOLDER
  : readRoster();

function readRoster() {
  const file = new URL("../league.roster.json", import.meta.url);
  if (!existsSync(file)) {
    // Refuse rather than substitute. league.roster.json is gitignored, so it
    // is missing in every fresh clone and on any second machine -- exactly
    // when someone would run this against the LIVE database. Falling back to
    // the placeholder names there would add ten strangers to the league,
    // one of them a second commissioner, and --prune would then delete the
    // real members as strays.
    console.error(
      "\nNo league.roster.json found — refusing to run.\n\n" +
        "This file is gitignored, so it is missing in a fresh clone. Seeding\n" +
        "with the placeholder names would add ten accounts that are not your\n" +
        "league, including a second commissioner.\n\n" +
        "  cp league.roster.example.json league.roster.json\n" +
        "  # then put your actual league in it\n\n" +
        "If you genuinely want the placeholder names (a scratch database, a\n" +
        "demo), pass --placeholder.\n",
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`\nleague.roster.json is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }

  const members = Array.isArray(parsed) ? parsed : parsed?.members;
  if (!Array.isArray(members) || members.length === 0) {
    console.error(
      '\nleague.roster.json needs a "members" array. See league.roster.example.json.\n',
    );
    process.exit(1);
  }

  const seen = new Set();
  for (const m of members) {
    if (typeof m?.username !== "string" || m.username.trim() === "") {
      console.error("\nEvery member needs a username.\n");
      process.exit(1);
    }
    const key = m.username.trim().toLowerCase();
    if (seen.has(key)) {
      console.error(`\nTwo members share the username "${key}".\n`);
      process.exit(1);
    }
    seen.add(key);
  }

  const admins = members.filter((m) => m.admin === true).length;
  if (admins === 0) {
    console.log('\nWarning: nobody has "admin": true, so no commissioner.\n');
  } else if (admins > 1) {
    console.log(`\nNote: ${admins} members are marked commissioner.\n`);
  }

  return members.map((m) => ({
    username: m.username.trim(),
    displayName: (m.displayName ?? m.username).trim(),
    admin: m.admin === true,
  }));
}

const resolved = resolveDatabaseUrl();
if (!resolved) {
  console.error(`\n${missingUrlMessage()}\n`);
  process.exit(1);
}
const url = resolved.url;
const { sql, client } = await connect(url);

const resetIndex = process.argv.indexOf("--reset");
if (resetIndex !== -1) {
  const username = process.argv[resetIndex + 1];
  if (!username) {
    console.error("Usage: node scripts/seed-users.mjs --reset <username>");
    process.exit(1);
  }
  const password = generatePassword();
  const hash = await hashPassword(password);
  const rows = await sql`
    UPDATE users SET password_hash = ${hash}
    WHERE lower(username) = lower(${username})
    RETURNING username
  `;
  if (rows.length === 0) {
    console.error(`No user called "${username}".`);
    process.exit(1);
  }
  await client.end();
  console.log(`\n  ${rows[0].username}  ->  ${password}\n`);
  console.log("Give them that password. It is not stored anywhere in readable form.\n");
  process.exit(0);
}

const created = [];
const updated = [];
const unchanged = [];

for (const member of LEAGUE) {
  const existing = await sql`
    SELECT id, display_name, is_admin
    FROM users WHERE lower(username) = lower(${member.username})
  `;

  if (existing.length > 0) {
    // Already here. Bring the display name and commissioner flag in line with
    // the list -- editing LEAGUE after seeding should actually take effect.
    // The password is deliberately left alone; use --reset to change one.
    const row = existing[0];
    const wantsAdmin = member.admin === true;
    if (row.display_name !== member.displayName || row.is_admin !== wantsAdmin) {
      await sql`
        UPDATE users
        SET display_name = ${member.displayName}, is_admin = ${wantsAdmin}
        WHERE id = ${row.id}
      `;
      updated.push(member.username);
    } else {
      unchanged.push(member.username);
    }
    continue;
  }

  const password = generatePassword();
  const hash = await hashPassword(password);
  await sql`
    INSERT INTO users (username, display_name, password_hash, is_admin)
    VALUES (${member.username}, ${member.displayName}, ${hash},
            ${member.admin === true})
  `;
  created.push({ ...member, password });
}

/* --- Accounts in the database that are no longer in LEAGUE ---------------- */

const usernames = LEAGUE.map((m) => m.username.toLowerCase());
const strays = await sql`
  SELECT u.id, u.username,
         (SELECT count(*) FROM parlay_legs l WHERE l.user_id = u.id)::int AS legs,
         (SELECT count(*) FROM side_bets b
           WHERE b.proposer_id = u.id OR b.taker_id = u.id)::int AS bets,
         -- Every other column that points at a user. Without these the delete
         -- fails on a foreign key mid-loop, after earlier strays are gone.
         (
           (SELECT count(*) FROM parlays p WHERE p.placer_user_id = u.id)
           + (SELECT count(*) FROM parlay_legs l WHERE l.graded_by = u.id)
           + (SELECT count(*) FROM side_bets b WHERE b.settled_by = u.id)
           + (SELECT count(*) FROM side_bets b WHERE b.paid_by = u.id)
         )::int AS refs
  FROM users u
  WHERE lower(u.username) <> ALL(${usernames})
  ORDER BY u.username
`;

if (strays.length > 0) {
  const prune = process.argv.includes("--prune");
  const withData = strays.filter((s) => s.legs > 0 || s.bets > 0 || s.refs > 0);

  if (!prune) {
    console.log(
      `\nIn the database but not in your roster: ${strays.map((s) => s.username).join(", ")}`,
    );
    console.log("They can still log in. To delete them:  npm run db:seed -- --prune");
  } else if (withData.length > 0) {
    // Deleting a user cascades to their legs and bets. Never do that silently.
    console.error("\nRefusing to delete accounts that have league history:");
    for (const s of withData) {
      const parts = [];
      if (s.legs > 0) parts.push(`${s.legs} parlay leg(s)`);
      if (s.bets > 0) parts.push(`${s.bets} side bet(s)`);
      if (s.refs > 0) parts.push(`${s.refs} other reference(s) (placed a week, graded, or settled something)`);
      console.error(`  ${s.username} -- ${parts.join(", ")}`);
    }
    console.error(
      "\nDeleting them would take that history with them. Nothing was\n" +
        "deleted -- remove their history first, or leave the accounts.\n",
    );
    await client.end();
    process.exit(1);
  } else {
    // All or nothing: a failure partway through must not leave the league
    // half-deleted.
    try {
      await client.query("BEGIN");
      for (const s of strays) {
        await sql`DELETE FROM users WHERE id = ${s.id}`;
      }
      await client.query("COMMIT");
      console.log(`\nDeleted (no history): ${strays.map((s) => s.username).join(", ")}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`\nDeleted nothing — ${err.message}\n`);
      await client.end();
      process.exit(1);
    }
  }
}

/* --- Report ---------------------------------------------------------------- */

if (updated.length > 0) {
  console.log(`\nRenamed to match LEAGUE: ${updated.join(", ")}`);
}
if (unchanged.length > 0) {
  console.log(`Already correct: ${unchanged.join(", ")}`);
}

if (created.length === 0) {
  console.log("\nNo new accounts to create.\n");
  await client.end();
  process.exit(0);
}

console.log("\n" + "=".repeat(54));
console.log("  HAND THESE OUT. THEY ARE NOT SHOWN AGAIN.");
console.log("=".repeat(54));
for (const m of created) {
  const tag = m.admin ? "  (commissioner)" : "";
  console.log(`  ${m.username.padEnd(10)} ${m.password}${tag}`);
}
console.log("=".repeat(54));
console.log(
  "\nPasswords are stored only as scrypt hashes -- nobody, including you,\n" +
    "can read them back out. Lost one? Reset it:\n" +
    "  node scripts/seed-users.mjs --reset <username>\n",
);

await client.end();
