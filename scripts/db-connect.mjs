import pg from "pg";

/**
 * Shared connection helper for the command-line scripts.
 * Returns a tagged-template `sql` function plus the raw client.
 */
export async function connect(url) {
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  const sql = async (strings, ...values) => {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    );
    const result = await client.query(text, values);
    return result.rows;
  };

  return { sql, client };
}
