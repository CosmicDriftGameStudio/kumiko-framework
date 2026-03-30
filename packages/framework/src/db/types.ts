import type { DbConnection } from "./connection";

export type DbAdapter = {
  connect(): Promise<void>;
  close(): Promise<void>;
  getConnection(): DbConnection;
};
