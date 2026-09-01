import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDatabaseUrl,
  needsSsl,
  missingUrlMessage,
  POOLED_VARS,
  UNPOOLED_VARS,
} from "../src/lib/db-url.ts";

const REAL = "postgresql://u:p@ep-cool-name-pooler.us-east-2.aws.neon.tech/db";

test("finds DATABASE_URL (Neon and most integrations)", () => {
  const r = resolveDatabaseUrl({ DATABASE_URL: REAL });
  assert.equal(r?.url, REAL);
  assert.equal(r?.source, "DATABASE_URL");
  assert.equal(r?.isPooled, true);
});

test("finds POSTGRES_URL when DATABASE_URL is absent", () => {
  const r = resolveDatabaseUrl({ POSTGRES_URL: REAL });
  assert.equal(r?.source, "POSTGRES_URL");
  assert.equal(r?.isPooled, true);
});

test("finds POSTGRES_PRISMA_URL as well", () => {
  assert.equal(resolveDatabaseUrl({ POSTGRES_PRISMA_URL: REAL })?.source, "POSTGRES_PRISMA_URL");
});

test("DATABASE_URL wins when several are set", () => {
  const r = resolveDatabaseUrl({
    POSTGRES_URL: "postgresql://u:p@other/db",
    DATABASE_URL: REAL,
  });
  assert.equal(r?.source, "DATABASE_URL");
});

test("pooled is preferred over unpooled", () => {
  const r = resolveDatabaseUrl({
    POSTGRES_URL_NON_POOLING: "postgresql://u:p@direct.neon.tech/db",
    POSTGRES_URL: REAL,
  });
  assert.equal(r?.source, "POSTGRES_URL");
  assert.equal(r?.isPooled, true);
});

test("falls back to an unpooled URL and flags it", () => {
  const r = resolveDatabaseUrl({ POSTGRES_URL_NON_POOLING: REAL });
  assert.equal(r?.isPooled, false);
  assert.equal(r?.source, "POSTGRES_URL_NON_POOLING");
});

test("every advertised variable name actually resolves", () => {
  for (const name of [...POOLED_VARS, ...UNPOOLED_VARS]) {
    assert.equal(resolveDatabaseUrl({ [name]: REAL })?.source, name);
  }
});

test("the .env.example placeholder counts as unset", () => {
  // This is the exact trap: pasting the placeholder into Vercel would
  // otherwise produce a baffling DNS failure for a host literally named "host".
  assert.equal(
    resolveDatabaseUrl({
      DATABASE_URL: "postgresql://user:password@host/dbname?sslmode=require",
    }),
    null,
  );
});

test("other junk values count as unset too", () => {
  for (const bad of ["", "   ", "postgresql://", "replace-me", "postgres://<host>/db"]) {
    assert.equal(resolveDatabaseUrl({ DATABASE_URL: bad }), null, `${bad} should be ignored`);
  }
});

test("a placeholder does not mask a real value further down the list", () => {
  const r = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://user:password@host/dbname",
    POSTGRES_URL: REAL,
  });
  assert.equal(r?.source, "POSTGRES_URL");
});

test("nothing set returns null", () => {
  assert.equal(resolveDatabaseUrl({}), null);
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: `  ${REAL}  ` })?.url, REAL);
});

test("SSL is required for hosted, skipped for local", () => {
  assert.equal(needsSsl(REAL), true);
  assert.equal(needsSsl("postgresql://postgres@127.0.0.1:5433/hfl"), false);
  assert.equal(needsSsl("postgresql://postgres@localhost:5432/hfl"), false);
  // A hostname that merely contains "localhost" is still remote.
  assert.equal(needsSsl("postgresql://u:p@localhost.example.com/db"), true);
});

test("the missing-URL message names every variable it checked", () => {
  const msg = missingUrlMessage();
  for (const name of [...POOLED_VARS, ...UNPOOLED_VARS]) {
    assert.ok(msg.includes(name), `message should mention ${name}`);
  }
  assert.ok(msg.includes(".env.example"));
});

/* --- Custom prefixes ------------------------------------------------------
 * Some integrations offer a "custom prefix" at setup time, which renames the
 * variables they create (DATABASE_URL -> STORAGE_DATABASE_URL). Blank is the
 * right answer, but the app should cope if one was set anyway.
 */

test("a prefixed DATABASE_URL is still found", () => {
  const r = resolveDatabaseUrl({ STORAGE_DATABASE_URL: REAL });
  assert.equal(r?.url, REAL);
  assert.equal(r?.source, "STORAGE_DATABASE_URL");
  assert.equal(r?.isPooled, true);
});

test("a prefixed POSTGRES_URL is still found", () => {
  assert.equal(resolveDatabaseUrl({ MY_APP_POSTGRES_URL: REAL })?.source, "MY_APP_POSTGRES_URL");
});

test("an unprefixed name still beats a prefixed one", () => {
  const r = resolveDatabaseUrl({
    STORAGE_DATABASE_URL: "postgresql://u:p@prefixed/db",
    DATABASE_URL: REAL,
  });
  assert.equal(r?.source, "DATABASE_URL");
});

test("a prefixed pooled URL beats a prefixed unpooled one", () => {
  const r = resolveDatabaseUrl({
    STORAGE_POSTGRES_URL_NON_POOLING: "postgresql://u:p@direct/db",
    STORAGE_DATABASE_URL: REAL,
  });
  assert.equal(r?.source, "STORAGE_DATABASE_URL");
  assert.equal(r?.isPooled, true);
});

test("a prefixed unpooled URL is flagged as unpooled", () => {
  const r = resolveDatabaseUrl({ STORAGE_POSTGRES_URL_NON_POOLING: REAL });
  assert.equal(r?.isPooled, false);
});

test("prefix matching requires an underscore boundary", () => {
  // MYDATABASE_URL is somebody else's variable, not a prefixed DATABASE_URL.
  assert.equal(resolveDatabaseUrl({ MYDATABASE_URL: REAL }), null);
});

test("unrelated variables are never mistaken for a connection string", () => {
  assert.equal(
    resolveDatabaseUrl({
      SESSION_SECRET: "abc123",
      SLEEPER_LEAGUE_ID: "123456",
      PATH: "/usr/bin",
      NEXT_PUBLIC_URL: "https://example.com",
    }),
    null,
  );
});

test("prefixed placeholders are ignored like unprefixed ones", () => {
  assert.equal(
    resolveDatabaseUrl({ STORAGE_DATABASE_URL: "postgresql://user:password@host/dbname" }),
    null,
  );
});

test("prefixed resolution is deterministic with several matches", () => {
  const env = { B_DATABASE_URL: "postgresql://u:p@b/db", A_DATABASE_URL: "postgresql://u:p@a/db" };
  const first = resolveDatabaseUrl(env)?.source;
  assert.equal(first, "A_DATABASE_URL");
  // Same answer regardless of key insertion order.
  assert.equal(resolveDatabaseUrl({ A_DATABASE_URL: env.A_DATABASE_URL, B_DATABASE_URL: env.B_DATABASE_URL })?.source, first);
});

/* ---------------------------------------------------------------------------
 * preferDirect: the backup wants the opposite preference to the website.
 * A pooler in transaction mode can hand each statement to a different backend,
 * which would break the single snapshot a dump reads from.
 * ------------------------------------------------------------------------ */

const POOLED = "postgresql://u:p@ep-cool-name-pooler.us-east-2.aws.neon.tech/db";
const DIRECT = "postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/db";

test("preferDirect takes the unpooled string even when a pooled one is set", () => {
  const r = resolveDatabaseUrl(
    { DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT },
    { preferDirect: true },
  );
  assert.equal(r?.url, DIRECT);
  assert.equal(r?.isPooled, false);
});

test("preferDirect finds a prefixed unpooled name too", () => {
  const r = resolveDatabaseUrl(
    { DATABASE_URL: POOLED, STORAGE_DATABASE_URL_UNPOOLED: DIRECT },
    { preferDirect: true },
  );
  assert.equal(r?.url, DIRECT);
  assert.equal(r?.isPooled, false);
});

test("preferDirect falls back to the pooled string rather than failing", () => {
  // Plenty of setups only ever set DATABASE_URL. A pooled dump still works;
  // the script says so rather than refusing to back anything up.
  const r = resolveDatabaseUrl({ DATABASE_URL: POOLED }, { preferDirect: true });
  assert.equal(r?.url, POOLED);
  assert.equal(r?.isPooled, true);
});

test("preferDirect ignores a placeholder unpooled string", () => {
  const r = resolveDatabaseUrl(
    { DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: "postgresql://user:password@host/dbname" },
    { preferDirect: true },
  );
  assert.equal(r?.url, POOLED);
});

test("the website's default is unchanged: pooled still wins", () => {
  const r = resolveDatabaseUrl({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
  assert.equal(r?.url, POOLED);
  assert.equal(r?.isPooled, true);
});
