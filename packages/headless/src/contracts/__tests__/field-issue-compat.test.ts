import { describe, expect, test } from "bun:test";
import type { FieldIssue as FrameworkFieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import type { FieldIssue as HeadlessFieldIssue } from "../../index";

// Lives in headless (not framework) because headless already depends on
// framework — the reverse import (framework → headless) would introduce a
// dependency cycle that breaks standalone typecheck + published-isolation.
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
