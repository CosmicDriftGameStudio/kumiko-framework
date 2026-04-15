import type { WriteResult } from "../engine/types";
import type { WriteErrorInfo } from "../errors";

export function expectSuccess<T>(
  result: WriteResult<T>,
): asserts result is { isSuccess: true; data: T } {
  if (!result.isSuccess) {
    throw new Error(
      `Expected success but got error: ${result.error.code} (${result.error.message})`,
    );
  }
}

// `matcher` checks either the error code (e.g. "not_found") or looks for a
// substring in the message. Both are useful: code matches are stable across
// i18n changes, substrings catch feature-specific detail text.
export function expectError(
  result: WriteResult,
  matcher?: string,
): asserts result is { isSuccess: false; error: WriteErrorInfo } {
  if (result.isSuccess) {
    throw new Error("Expected error but got success");
  }
  if (matcher === undefined) {
    // skip: caller only asked for the type narrowing; nothing else to check.
    return;
  }
  const err = result.error;
  const hit = err.code === matcher || err.message.includes(matcher);
  if (!hit) {
    throw new Error(
      `Expected error code or message to match "${matcher}" but got code="${err.code}", message="${err.message}"`,
    );
  }
}
