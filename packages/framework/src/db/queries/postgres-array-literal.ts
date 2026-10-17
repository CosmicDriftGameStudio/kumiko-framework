export type PostgresArrayElement = string | number | bigint | null;

// Bun.SQL stringifies JS arrays via toString, so array params travel as a
// Postgres array-literal string (`$1::text[]`) — identical on postgres-js and Bun.SQL.
export function toPostgresArrayLiteral(values: readonly PostgresArrayElement[]): string {
  const elements = values.map((value) =>
    value === null ? "NULL" : `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${elements.join(",")}}`;
}
