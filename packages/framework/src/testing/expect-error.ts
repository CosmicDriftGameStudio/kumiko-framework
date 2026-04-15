import { expect } from "vitest";
import type { WriteErrorInfo } from "../errors";

// Vitest's toContain doesn't operate on plain objects, so after the move from
// string errors to typed WriteErrorInfo the legacy `expect(error).toContain(x)`
// assertions break. This helper concatenates code, message, and serialized
// details so existing substring checks against short reason strings keep
// working without each call site needing to know the new shape.
//
// Accepts `string | null` too, so call sites that still get raw strings
// (e.g. helpers that haven't moved to typed errors yet) keep working.
export function expectErrorIncludes(
  err: WriteErrorInfo | string | null | undefined,
  substring: string,
): void {
  let haystack: string;
  if (err === null || err === undefined) {
    haystack = String(err);
  } else if (typeof err === "string") {
    haystack = err;
  } else {
    haystack = `${err.code} ${err.message} ${JSON.stringify(err.details ?? {})}`;
  }
  expect(haystack).toContain(substring);
}
