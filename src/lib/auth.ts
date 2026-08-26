import { cookies } from "next/headers";
import { sql } from "./db.ts";
import {
  createSessionToken,
  readSessionToken,
  hashPassword,
  verifyPassword,
  SESSION_DAYS,
} from "./crypto.ts";

const COOKIE_NAME = "hfl_session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need 16+ chars). Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return value;
}

/** Shape of a row from the users table. */
type UserRow = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: boolean;
  sleeper_user_id: string | null;
};

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  sleeperUserId: string | null;
};

function toSessionUser(row: Omit<UserRow, "password_hash">): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    sleeperUserId: row.sleeper_user_id,
  };
}

export async function setSessionCookie(userId: number): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, createSessionToken(userId, secret()), {
    httpOnly: true, // page JavaScript cannot read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** The logged-in user, or null. Safe to call from any server component. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const userId = readSessionToken(jar.get(COOKIE_NAME)?.value, secret());
  if (userId === null) return null;

  const rows = await sql<Omit<UserRow, "password_hash">>`
    SELECT id, username, display_name, is_admin, sleeper_user_id
    FROM users WHERE id = ${userId}
  `;
  return rows.length > 0 ? toSessionUser(rows[0]) : null;
}

/** Look up a user by username and check their password. */
export async function authenticate(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const rows = await sql<UserRow>`
    SELECT id, username, display_name, password_hash, is_admin, sleeper_user_id
    FROM users WHERE lower(username) = lower(${username.trim()})
  `;

  if (rows.length === 0) {
    // Hash anyway so an unknown username costs the same time as a wrong
    // password. Otherwise response timing quietly leaks who has an account.
    await hashPassword(password);
    return null;
  }

  const row = rows[0];
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return toSessionUser(row);
}

export { hashPassword, verifyPassword };
