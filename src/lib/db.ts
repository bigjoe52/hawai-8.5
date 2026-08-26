import { Pool } from "pg";
import {
  resolveDatabaseUrl,
  missingUrlMessage,
  needsSsl,
} from "./db-url.ts";

/**
 * One connection pool per server instance.
 *
 * `pg` speaks the standard Postgres wire protocol, so the same code works
 * against any Postgres host -- Neon, Supabase, Prisma Postgres, or a plain
 * local server. See db-url.ts for how the connection string is located.
 */
declare global {
  // eslint-disable-next-line no-var
  var __hflPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__hflPool) {
    const resolved = resolveDatabaseUrl();
    if (!resolved) throw new Error(missingUrlMessage());

    if (!resolved.isPooled) {
      // Not fatal -- the site works -- but on serverless this will run out of
      // connections under load, so make sure it shows up in the logs.
      console.warn(
        `[db] Using ${resolved.source}, which is a direct (unpooled) ` +
          "connection. Prefer the pooled connection string (its host " +
          "usually contains '-pooler') to avoid exhausting connections.",
      );
    }

    globalThis.__hflPool = new Pool({
      connectionString: resolved.url,
      // Hosted Postgres requires TLS; a local dev server has no certificate.
      ssl: needsSsl(resolved.url) ? { rejectUnauthorized: false } : false,
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
