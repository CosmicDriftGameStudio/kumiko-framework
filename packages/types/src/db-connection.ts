import type postgres from "postgres";

// biome-ignore lint/suspicious/noExplicitAny: Bun.SQL global type
export type DbConnection = ReturnType<typeof postgres> | any;
// biome-ignore lint/suspicious/noExplicitAny: postgres-js namespace lookup
export type DbTx = postgres.TransactionSql<any> | any;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = ReturnType<typeof postgres>;

export type PgListenClient = ReturnType<typeof postgres>;
