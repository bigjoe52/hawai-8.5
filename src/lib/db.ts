import { Pool } from "pg";

/**
 * One connection pool per server instance.
 *
 * `pg` speaks the standard Postgres wire protocol, so the same code works
 * against Vercel/Neon in production and a plain local Postgres in development.
 * On Vercel, use the POOLED connection string (the host with `-pooler` in it)
 * so serverless invocations don't exhaust the connection limit.
 */
declare global {
  // eslint-disable-next-line no-var
  var __hflPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__hflPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. On Vercel, add a Postgres store to the " +
          "project and it gets set automatically. Locally, copy .env.example " +
          "to .env.local and fill it in.",
      );
    }

    globalThis.__hflPool = new Pool({
      connectionString,
      // Hosted Postgres (Neon, Supabase, Vercel) requires TLS; a local
      // development server generally does not have a certificate at all.
      ssl: /localhost|127\.0\.0\.1/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.__hflPool;
}

/**
 * Tagged-template query helper:
 *
 *   const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
 *
 * Values written as ${...} become bound parameters ($1, $2, ...), never
 * string-concatenated into the SQL. That is what makes this injection-safe.
 * Never build a query by joining strings together.
 */
export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const text = strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
  const result = await pool().query(text, values);
  return result.rows as T[];
}

/** Run several statements in one transaction; rolls back if anything throws. */
export async function transaction<T>(
  fn: (
    q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params) => {
      const r = await client.query(text, params);
      return r.rows;
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
