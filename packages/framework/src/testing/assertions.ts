import type { WriteResult } from "../engine/types";

export function expectSuccess<T>(
  result: WriteResult<T>,
): asserts result is { isSuccess: true; data: T } {
  if (!result.isSuccess) {
    throw new Error(`Expected success but got error: ${result.error}`);
  }
}

export function expectError(
  result: WriteResult,
  errorSubstring?: string,
): asserts result is { isSuccess: false; error: string } {
  if (result.isSuccess) {
    throw new Error("Expected error but got success");
  }
  if (errorSubstring && !result.error.includes(errorSubstring)) {
    throw new Error(`Expected error containing "${errorSubstring}" but got: ${result.error}`);
  }
}
