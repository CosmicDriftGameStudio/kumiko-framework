import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { FrameworkErrorCode } from "./error-codes.ts";
import type { WriteFailure } from "./write-error-info.ts";

const VERSION_CONFLICT_CODE: FrameworkErrorCode = "version_conflict";

export function isVersionConflictFailure(result: WriteResult<unknown>): result is WriteFailure {
  return !result.isSuccess && result.error.code === VERSION_CONFLICT_CODE;
}

// `attempt` must re-read the row it writes: the conflict surfaces only after the competing
// write committed, so the second attempt runs its own checks against that fresh state.
export async function retryOnceOnVersionConflict<T>(
  attempt: () => Promise<WriteResult<T>>,
): Promise<WriteResult<T>> {
  const first = await attempt();
  return isVersionConflictFailure(first) ? attempt() : first;
}
