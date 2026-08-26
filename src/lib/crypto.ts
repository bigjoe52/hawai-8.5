import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export const SESSION_DAYS = 30;

/* -------------------------------------------------------------------------
 * Passwords
 * ---------------------------------------------------------------------- */

/**
 * Hash a password with scrypt, which is deliberately slow and memory-hard.
 * Format: scrypt$<salt-hex>$<hash-hex>
 *
 * scrypt ships in Node's standard library, so there is no native module to
 * compile and nothing extra to install.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verify a password against a stored hash, in constant time. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  // timingSafeEqual throws if lengths differ, so guard first.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* -------------------------------------------------------------------------
 * Session tokens
 * ---------------------------------------------------------------------- */

/**
 * The token is `<userId>.<expiry>.<signature>`.
 *
 * The signature is an HMAC over the first two fields, so a user can read their
 * own cookie but cannot change the user id inside it without invalidating it.
 * This is the whole reason login has to live on a server: on a purely static
 * site there is nowhere to keep this secret.
 */
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken(
  userId: number,
  secret: string,
  now: number = Date.now(),
): string {
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id if the token is authentic and unexpired, else null. */
export function readSessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [rawUserId, rawExpiry, signature] = parts;
  const payload = `${rawUserId}.${rawExpiry}`;

  const expected = Buffer.from(sign(payload, secret), "hex");
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return null;

  const userId = Number(rawUserId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

/** Readable, unambiguous passwords to hand out to the league. */
export function generatePassword(): string {
  // No 0/O/1/l/I -- these get misread when typed off a text message.
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
