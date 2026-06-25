import { describe, expect, test } from "bun:test";
import type {
  DispatcherError,
  EditFieldViewModel,
  EditSectionViewModel,
  SubmitResult,
} from "@cosmicdrift/kumiko-headless";
import {
  hasEditableSection,
  resolveExtensionEntityId,
  shouldNotifyCaller,
} from "../render-edit-logic";

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
  test("explicit id prop wins over vm.id", () => {
    expect(resolveExtensionEntityId("entity-42", "row-7")).toBe("entity-42");
  });

  // The #345/1 regression: mount fell back to vm.id but persist did not, so a
  // custom-fields section mounted editable against the existing row yet saved
  // to null → silent data loss. Both sites now resolve this same value.
  test("undefined prop → vm.id fallback (update form carries the row id)", () => {
    expect(resolveExtensionEntityId(undefined, "row-42")).toBe("row-42");
  });

  test("undefined prop + no vm.id (create mode) → null", () => {
    expect(resolveExtensionEntityId(undefined, null)).toBeNull();
  });

  test("explicit null prop forces null even when vm.id is present", () => {
    expect(resolveExtensionEntityId(null, "row-42")).toBeNull();
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

const field = (readOnly: boolean): EditFieldViewModel => ({
  field: "f",
  label: "F",
  type: "text",
  value: "",
  visible: true,
  readOnly,
  required: false,
});
const fieldsSection = (...readOnly: boolean[]): EditSectionViewModel => ({
  kind: "fields",
  columns: 1,
  fields: readOnly.map(field),
});
const extensionSection: EditSectionViewModel = {
  kind: "extension",
  title: "Custom",
  component: {},
};

describe("hasEditableSection", () => {
  // A read-only inspector detail (export-job/download-attempt) marks every field
  // readOnly + has no create/delete — there is nothing to submit, so the Save
  // button must not render at all (a disabled one reads as a broken control).
  test("every field readOnly → false (no Save button)", () => {
    expect(hasEditableSection([fieldsSection(true, true, true)])).toBe(false);
  });

  test("one editable field → true", () => {
    expect(hasEditableSection([fieldsSection(true, false)])).toBe(true);
  });

  test("editable field in a later section → true", () => {
    expect(hasEditableSection([fieldsSection(true), fieldsSection(false)])).toBe(true);
  });

  test("extension section counts as editable (carries its own save)", () => {
    expect(hasEditableSection([extensionSection])).toBe(true);
  });

  test("no sections → false", () => {
    expect(hasEditableSection([])).toBe(false);
  });
});
