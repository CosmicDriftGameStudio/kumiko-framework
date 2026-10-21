export type PostgresArrayElement = string | number | bigint | null;

// Array params travel as a Postgres array-literal string (`$1::text[]`) so the
// binding does not depend on how the driver infers JS array types.
export function toPostgresArrayLiteral(values: readonly PostgresArrayElement[]): string {
  const elements = values.map((value) =>
    value === null ? "NULL" : `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${elements.join(",")}}`;
}
