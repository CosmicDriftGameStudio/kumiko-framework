import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";

// GDPR-forget hooks used to `await crud.forget(...)` and drop the result —
// a silent ownership_denied (or any other failure) meant the row was never
// actually erased, with nothing surfacing the miss. Callers must assert.
export function assertErased(result: WriteResult<unknown>, entityName: string, id: string): void {
  // skip: the happy path — the assertion below only concerns failures.
  if (result.isSuccess) return;
  // skip: erasure is idempotent — a row that is already gone (e.g. a parallel
  // forget sweep) satisfies the erase request just as well as one this call removed.
  if (result.error.code === "not_found") return;
  throw new Error(
    `[user-data-rights] failed to erase ${entityName}/${id}: ${result.error.code} — ${result.error.message}`,
  );
}
