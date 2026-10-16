import { describe, expect, test } from "bun:test";
import { errorTextWithFieldIssues } from "../field-issue-text.js";

const translate = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  key === "known.key" ? `known ${String(params?.["detail"])}` : key;

describe("errorTextWithFieldIssues", () => {
  test("appends one line per field issue, falling back to path and code for unknown keys", () => {
    const text = errorTextWithFieldIssues(
      {
        code: "validation_error",
        httpStatus: 400,
        i18nKey: "validation.failed",
        message: "Validation failed",
        details: {
          fields: [
            {
              path: "content",
              code: "unknown_placeholder",
              i18nKey: "known.key",
              params: { detail: "x" },
            },
            { path: "meta.subject", code: "invalid_meta", i18nKey: "missing.key" },
          ],
        },
      },
      translate,
    );
    expect(text).toContain("known x");
    expect(text).toContain("meta.subject: invalid_meta");
  });

  test("keeps the plain message without field issues", () => {
    const text = errorTextWithFieldIssues(
      { code: "boom", httpStatus: 500, i18nKey: "x", message: "Boom" },
      translate,
    );
    expect(text).toBe("Boom");
  });
});
