import type { DispatcherError, SubmitResult } from "@cosmicdrift/kumiko-headless";
import { describe, expect, test } from "bun:test";
import { resolveExtensionEntityId, shouldNotifyCaller } from "../render-edit-logic";

const error: DispatcherError = {
  code: "internal_error",
  httpStatus: 500,
  i18nKey: "kumiko.errors.internal",
  message: "boom",
};

const success: SubmitResult<unknown> = { validationBlocked: false, isSuccess: true, data: {} };
const writeFailure: SubmitResult<unknown> = { validationBlocked: false, isSuccess: false, error };
const validationBlocked: SubmitResult<unknown> = { validationBlocked: true, isSuccess: false };

describe("resolveExtensionEntityId", () => {
  test("explicit id is used as-is (update mode)", () => {
    expect(resolveExtensionEntityId("entity-42")).toBe("entity-42");
  });

  test("undefined → null (create mode / no extension context), never a vm.id fallback", () => {
    expect(resolveExtensionEntityId(undefined)).toBeNull();
  });

  test("explicit null → null", () => {
    expect(resolveExtensionEntityId(null)).toBeNull();
  });
});

describe("shouldNotifyCaller", () => {
  // The one case the #345/1 fix changes: a successful entity write whose
  // extension persist failed must NOT notify (caller would navigate away and
  // unmount the extension-error banner → silent custom-field data loss). The
  // pre-fix code notified unconditionally, so this row flips false↔true.
  test("entity success + extension persist failed → suppress callback", () => {
    expect(shouldNotifyCaller(success, false)).toBe(false);
  });

  test("entity success + extensions persisted → notify", () => {
    expect(shouldNotifyCaller(success, true)).toBe(true);
  });

  test("entity write failure → notify (caller needs the error result)", () => {
    expect(shouldNotifyCaller(writeFailure, true)).toBe(true);
    // extensions never run on a failed entity write, but the flag must not
    // swallow the failure callback regardless of its value.
    expect(shouldNotifyCaller(writeFailure, false)).toBe(true);
  });

  test("validation blocked → notify", () => {
    expect(shouldNotifyCaller(validationBlocked, true)).toBe(true);
  });
});
