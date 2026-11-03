// Client-side Bun.SQL failures that mean the connection could not be used.
export const BUN_SQL_CONNECTION_ERROR_CODES: readonly string[] = [
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_CONNECTION_REFUSED",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_CONNECTION_FAILED",
];
