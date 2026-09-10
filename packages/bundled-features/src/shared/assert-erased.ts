import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";

// GDPR-forget hooks used to `await crud.forget(...)` and drop the result —
// a silent ownership_denied (or any other failure) meant the row was never
// actually erased, with nothing surfacing the miss. Callers must assert.
export function assertErased(result: WriteResult<unknown>, entityName: string, id: string): void {
  if (result.isSuccess) return;
  // not_found: the row is already gone (e.g. a parallel forget sweep) — not
  // a violation, nothing left to erase.
  if (result.error.code === "not_found") return;
  throw new Error(
    `[user-data-rights] failed to erase ${entityName}/${id}: ${result.error.code} — ${result.error.message}`,
  );
}
