/**
 * Find the Postgres connection string, whichever host set it.
 *
 * Different providers export the connection string under different names:
 * Neon and most integrations set DATABASE_URL, some Vercel-native and
 * Supabase setups set POSTGRES_URL, Prisma-flavoured ones set
 * POSTGRES_PRISMA_URL. Rather than making you rename anything by hand, we
 * look for all of them in a sensible order.
 *
 * POOLED connection strings come first. On serverless every request can open
 * its own connection, and a direct (unpooled) connection will hit the
 * database's connection limit under even light use. The unpooled names are
 * kept as a last resort so the site still comes up rather than showing an
 * error, and `isPooled` lets callers warn about it.
 */

/** Checked in order; the first one with a value wins. */
export const POOLED_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_POSTGRES_URL",
] as const;

export const UNPOOLED_VARS = [
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NO_SSL",
] as const;

export type ResolvedUrl = {
  url: string;
  /** Which environment variable it came from, for error messages. */
  source: string;
  /** False when we had to fall back to a direct connection. */
  isPooled: boolean;
};

/**
 * A placeholder copied out of .env.example is worse than nothing -- it fails
 * with a confusing DNS error instead of a clear "you didn't set this".
 */
function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  return (
    v.includes("user:password") ||
    v.includes("@host/") ||
    v.includes("replace-me") ||
    v.includes("<") ||
    v === "postgresql://" ||
    v === "postgres://"
  );
}

export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): ResolvedUrl | null {
  for (const name of POOLED_VARS) {
    const value = env[name];
    if (value && !isPlaceholder(value)) {
      return { url: value.trim(), source: name, isPooled: true };
    }
  }
  for (const name of UNPOOLED_VARS) {
    const value = env[name];
    if (value && !isPlaceholder(value)) {
      return { url: value.trim(), source: name, isPooled: false };
    }
  }
  return null;
}

/** A long, specific error beats a stack trace when you're setting this up. */
export function missingUrlMessage(): string {
  return [
    "No Postgres connection string found.",
    "",
    `Looked for: ${[...POOLED_VARS, ...UNPOOLED_VARS].join(", ")}`,
    "",
    "On Vercel: add a Postgres database under Storage and the integration",
    "sets this for you. If you pasted the placeholder from .env.example",
    "(postgresql://user:password@host/dbname) delete it -- a placeholder is",
    "treated as unset, and it blocks the integration from setting the real one.",
    "",
    "Locally: copy .env.example to .env.local and fill in DATABASE_URL.",
  ].join("\n");
}

/** Local development servers generally have no TLS certificate at all. */
export function needsSsl(url: string): boolean {
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/ ]/.test(url);
}
