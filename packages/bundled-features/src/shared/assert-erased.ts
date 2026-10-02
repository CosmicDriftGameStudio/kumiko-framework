import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";

// GDPR-forget hooks used to `await crud.forget(...)` and drop the result —
// a silent ownership_denied (or any other failure) meant the row was never
// actually erased, with nothing surfacing the miss. Callers must collect the
// failure of every row (so one bad row does not leave the rest of the
// subject's rows untried) and throw once after the loop.
export function collectErasureFailure(
  result: WriteResult<unknown>,
  entityName: string,
  id: string,
  failures: string[],
): void {
  // skip: the happy path — the collection below only concerns failures.
  if (result.isSuccess) return;
  // skip: erasure is idempotent — a row that is already gone (e.g. a parallel
  // forget sweep) satisfies the erase request just as well as one this call removed.
  if (result.error.code === "not_found") return;
  failures.push(`${entityName}/${id}: ${result.error.code} — ${result.error.message}`);
}

export function throwIfErasureFailed(failures: readonly string[]): void {
  if (failures.length === 0) return;
  throw new Error(`[user-data-rights] failed to erase ${failures.join("; ")}`);
}
