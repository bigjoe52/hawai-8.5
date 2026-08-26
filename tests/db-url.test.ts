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
