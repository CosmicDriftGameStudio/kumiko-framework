import { describe, expect, test } from "bun:test";
import type { FieldIssue as FrameworkFieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import type { FieldIssue as HeadlessFieldIssue } from "@cosmicdrift/kumiko-headless";

describe("FieldIssue cross-package contract", () => {
  test("framework and headless FieldIssue shapes are assignable", () => {
    const frameworkIssue: FrameworkFieldIssue = {
      path: "title",
      code: "too_small",
      i18nKey: "errors.validation.too_small",
      params: { minimum: 1 },
    };
    const headlessIssue: HeadlessFieldIssue = frameworkIssue;
    expect(headlessIssue.path).toBe("title");
  });
});
