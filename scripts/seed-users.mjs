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
import { connect } from "./db-connect.mjs";
import { resolveDatabaseUrl, missingUrlMessage } from "../src/lib/db-url.ts";
import { loadEnv } from "./load-env.mjs";
import { hashPassword, generatePassword } from "../src/lib/crypto.ts";

loadEnv();

// ---------------------------------------------------------------------------
// EDIT THIS: your ten league members.
// `admin: true` is the commissioner -- they can lock weeks, grade legs, and
// settle side bets. Give it to yourself.
// ---------------------------------------------------------------------------
const LEAGUE = [
  { username: "joe", displayName: "Joe", admin: true },
  { username: "mike", displayName: "Mike" },
  { username: "biz", displayName: "Biz" },
  { username: "chris", displayName: "Chris" },
  { username: "steve", displayName: "Steve" },
  { username: "tony", displayName: "Tony" },
  { username: "nick", displayName: "Nick" },
  { username: "matt", displayName: "Matt" },
  { username: "ryan", displayName: "Ryan" },
  { username: "sean", displayName: "Sean" },
];

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
           WHERE b.proposer_id = u.id OR b.taker_id = u.id)::int AS bets
  FROM users u
  WHERE lower(u.username) <> ALL(${usernames})
  ORDER BY u.username
`;

if (strays.length > 0) {
  const prune = process.argv.includes("--prune");
  const withData = strays.filter((s) => s.legs > 0 || s.bets > 0);

  if (!prune) {
    console.log(
      `\nIn the database but not in LEAGUE: ${strays.map((s) => s.username).join(", ")}`,
    );
    console.log("They can still log in. To delete them:  npm run db:seed -- --prune");
  } else if (withData.length > 0) {
    // Deleting a user cascades to their legs and bets. Never do that silently.
    console.error("\nRefusing to delete accounts that already have bets:");
    for (const s of withData) {
      console.error(`  ${s.username} -- ${s.legs} parlay leg(s), ${s.bets} side bet(s)`);
    }
    console.error(
      "\nDeleting them would delete that history too. Remove their bets first,\n" +
        "or leave the accounts in place.\n",
    );
    await client.end();
    process.exit(1);
  } else {
    for (const s of strays) {
      await sql`DELETE FROM users WHERE id = ${s.id}`;
    }
    console.log(`\nDeleted (no bets): ${strays.map((s) => s.username).join(", ")}`);
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
