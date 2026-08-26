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
  { username: "dave", displayName: "Dave" },
  { username: "chris", displayName: "Chris" },
  { username: "steve", displayName: "Steve" },
  { username: "tony", displayName: "Tony" },
  { username: "nick", displayName: "Nick" },
  { username: "matt", displayName: "Matt" },
  { username: "ryan", displayName: "Ryan" },
  { username: "sean", displayName: "Sean" },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run npm run db:setup first.");
  process.exit(1);
}
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
const skipped = [];

for (const member of LEAGUE) {
  const existing = await sql`
    SELECT id FROM users WHERE lower(username) = lower(${member.username})
  `;
  if (existing.length > 0) {
    skipped.push(member.username);
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

if (skipped.length > 0) {
  console.log(`\nAlready existed, left alone: ${skipped.join(", ")}`);
}

if (created.length === 0) {
  await client.end();
  console.log("\nNo new accounts to create.\n");
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
