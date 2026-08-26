import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  readSessionToken,
  generatePassword,
  SESSION_DAYS,
} from "../src/lib/crypto.ts";

const SECRET = "test-secret-that-is-long-enough-to-use";
const DAY = 24 * 60 * 60 * 1000;

test("a hashed password verifies against itself", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(await verifyPassword("correct horse battery staple", hash));
});

test("a wrong password does not verify", async () => {
  const hash = await hashPassword("hunter2");
  assert.equal(await verifyPassword("hunter3", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the password is never stored in the hash", async () => {
  const hash = await hashPassword("my-secret-password");
  assert.ok(!hash.includes("my-secret-password"));
  assert.ok(hash.startsWith("scrypt$"));
});

test("the same password hashes differently every time (salted)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  // ...but both still verify.
  assert.ok(await verifyPassword("same-password", a));
  assert.ok(await verifyPassword("same-password", b));
});

test("malformed hashes are rejected, not crashed on", async () => {
  for (const bad of ["", "nonsense", "scrypt$only-two", "bcrypt$aa$bb", "$$"]) {
    assert.equal(await verifyPassword("whatever", bad), false);
  }
});

test("a fresh session token reads back the user id", () => {
  const token = createSessionToken(7, SECRET);
  assert.equal(readSessionToken(token, SECRET), 7);
});

test("tampering with the user id invalidates the token", () => {
  // This is the attack that a static site cannot defend against: the user
  // edits their own cookie to claim they are the commissioner.
  const token = createSessionToken(7, SECRET);
  const [, expiry, signature] = token.split(".");
  const forged = `1.${expiry}.${signature}`;
  assert.equal(readSessionToken(forged, SECRET), null);
});

test("a token signed with a different secret is rejected", () => {
  const token = createSessionToken(7, "some-other-secret-entirely");
  assert.equal(readSessionToken(token, SECRET), null);
});

test("expired tokens are rejected", () => {
  const now = Date.now();
  const token = createSessionToken(7, SECRET, now);
  // Still good one day before expiry...
  assert.equal(readSessionToken(token, SECRET, now + (SESSION_DAYS - 1) * DAY), 7);
  // ...dead one day after.
  assert.equal(readSessionToken(token, SECRET, now + (SESSION_DAYS + 1) * DAY), null);
});

test("garbage tokens return null instead of throwing", () => {
  for (const bad of [undefined, "", "a.b.c", "1.2", "....", "1.2.3.4", "x.y.zz"]) {
    assert.equal(readSessionToken(bad as string | undefined, SECRET), null);
  }
});

test("generated passwords avoid characters people misread", () => {
  for (let i = 0; i < 50; i++) {
    const pw = generatePassword();
    assert.equal(pw.length, 12);
    assert.ok(!/[0O1lI]/.test(pw), `"${pw}" contains an ambiguous character`);
  }
});

test("generated passwords are not repeated", () => {
  const seen = new Set(Array.from({ length: 100 }, () => generatePassword()));
  assert.equal(seen.size, 100);
});
