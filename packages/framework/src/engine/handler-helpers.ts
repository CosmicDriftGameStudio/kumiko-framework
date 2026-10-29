import { isLifecycleResult } from "../pipeline/dispatcher-utils.ts";
import type { NameOrRef, WriteResult } from "./types/handlers.ts";

/**
 * Override the success-side `data` of a WriteResult while forwarding the
 * failure half untouched. Useful for handlers that delegate to the
 * event-store executor (which returns a SaveContext / DeleteContext
 * envelope) but want to keep their own response shape — caller contract
 * stays flat instead of leaking the executor's internals.
 *
 * ```ts
 * const result = await executor.delete({ id }, user, db);
 * return withResponseData(result, { userId, tenantId });
 * ```
 *
 * When the executor result is a save/delete, it rides along as `lifecycle`, so postSave/postDelete
 * hooks and projections still run; the dispatcher keeps it out of the response.
 *
 * On failure the same WriteFailure instance is returned — the error
 * object round-trips without any wrapping, so the dispatcher / HTTP layer
 * still read the original error code + httpStatus + i18nKey.
 */
export function withResponseData<T>(result: WriteResult<unknown>, data: T): WriteResult<T> {
  if (!result.isSuccess) return result;
  return isLifecycleResult(result.data)
    ? { isSuccess: true, data, lifecycle: result.data }
    : { isSuccess: true, data };
}

export function resolveName(ref: NameOrRef): string {
  return typeof ref === "string" ? ref : ref.name;
}
