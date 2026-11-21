import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

// Adapter and storage error texts can carry names, phone numbers or storage keys, and
// redactErrorText only strips emails, URLs and bot tokens. Logs and run rows take the class
// and an optional string code instead.
export function errorKindOf(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = errorCodeOf(err);
  return code === undefined ? name : `${name} (${code})`;
}
