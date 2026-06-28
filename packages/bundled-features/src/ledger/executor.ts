import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { accountEntity, transactionEntity } from "./entity";

// Shared tables + executors for the account + transaction handlers. Built once
// (side-effect-free). The tables back the report query-handlers (selectMany over
// the entity projections — see handlers/reports.query.ts).
export const { table: accountTable, executor: accountExecutor } = createEntityExecutor(
  "account",
  accountEntity,
);
export const { table: transactionTable, executor: transactionExecutor } = createEntityExecutor(
  "transaction",
  transactionEntity,
);
