import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { InternalError } from "./classes.ts";
import { isVersionConflict } from "./write-error-info.ts";

const DEFAULT_MAX_ATTEMPTS = 2;

// `attempt` must re-read the row it writes: the conflict surfaces only after the competing
// write committed, so the second attempt runs its own checks against that fresh state.
export async function retryOnVersionConflict<T>(
  attempt: () => Promise<WriteResult<T>>,
  options: { readonly maxAttempts?: number } = {},
): Promise<WriteResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new InternalError({
      message: `retryOnVersionConflict: maxAttempts must be a whole number of at least 1, got ${maxAttempts}`,
    });
  }
  let result = await attempt();
  for (let made = 1; made < maxAttempts && isVersionConflict(result); made++) {
    result = await attempt();
  }
  return result;
}
