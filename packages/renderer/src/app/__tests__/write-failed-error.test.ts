import { describe, expect, test } from "bun:test";
import type { DispatcherError } from "../../headless/index.ts";
import { dispatcherErrorText, dispatcherErrorTextWithFieldIssues } from "../write-failed-error.ts";

const translations: Readonly<Record<string, string>> = {
  "errors.unprocessable": "Generic",
  "banking.invalid_iban": "The IBAN is not valid.",
  "errors.custom": "Custom",
};

function translate(key: string): string {
  return translations[key] ?? key;
}

function unprocessableError(overrides: Partial<DispatcherError> = {}): DispatcherError {
  return {
    code: "unprocessable",
    httpStatus: 422,
    i18nKey: "errors.unprocessable",
    message: "unprocessable: banking.invalid_iban",
    details: { reason: "banking.invalid_iban" },
    ...overrides,
  };
}

describe("dispatcherErrorText with an unprocessable reason", () => {
  test("a known reason is translated instead of the generic text", () => {
    expect(dispatcherErrorText(unprocessableError(), translate)).toBe("The IBAN is not valid.");
  });

  test("an unknown reason falls back to the generic text", () => {
    const error = unprocessableError({ details: { reason: "x.unknown" } });
    expect(dispatcherErrorText(error, translate)).toBe("Generic");
  });

  test("an explicit i18nKey on the error wins over the reason", () => {
    const error = unprocessableError({ i18nKey: "errors.custom" });
    expect(dispatcherErrorText(error, translate)).toBe("Custom");
  });

  test("a different error code ignores the reason", () => {
    const error = unprocessableError({ code: "unconfigured" });
    expect(dispatcherErrorText(error, translate)).toBe("Generic");
  });
});

describe("dispatcherErrorTextWithFieldIssues with an unprocessable reason", () => {
  test("uses the translated reason as headline", () => {
    expect(dispatcherErrorTextWithFieldIssues(unprocessableError(), translate)).toBe(
      "The IBAN is not valid.",
    );
  });
});
