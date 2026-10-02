import { describe, expect, test } from "bun:test";
import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, throwIfErasureFailed } from "../assert-erased.js";

function failed(code: string, message: string): WriteResult<unknown> {
  // @cast-boundary test-fixture — only code/message are read by the collector
  return { isSuccess: false, error: { code, message } } as unknown as WriteResult<unknown>;
}

const succeeded = { isSuccess: true, data: {} } as WriteResult<unknown>; // @cast-boundary test-fixture

describe("erasure failure collection", () => {
  test("collects every failing row so one bad row does not hide the others", () => {
    const failures: string[] = [];
    collectErasureFailure(failed("ownership_denied", "no"), "config-value", "a", failures);
    collectErasureFailure(succeeded, "config-value", "b", failures);
    collectErasureFailure(failed("internal_error", "boom"), "config-value", "c", failures);

    expect(() => throwIfErasureFailed(failures)).toThrow(
      "config-value/a: ownership_denied — no; config-value/c: internal_error — boom",
    );
  });

  test("not_found counts as erased and success never throws", () => {
    const failures: string[] = [];
    collectErasureFailure(failed("not_found", "gone"), "fileRef", "a", failures);
    collectErasureFailure(succeeded, "fileRef", "b", failures);

    expect(failures).toEqual([]);
    expect(() => throwIfErasureFailed(failures)).not.toThrow();
  });
});
