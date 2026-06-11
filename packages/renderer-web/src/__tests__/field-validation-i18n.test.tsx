// Regression Bug-Bash-2 (2026-06-08): Validierungsfehler zeigten ROHE
// Keys ("errors.validation.invalid_format") — der Namespace den Server
// (ValidationError) und Client (zod-bridge) erzeugen war in keinem
// Default-Bundle definiert, und DefaultField reichte issue.params nicht
// an t() durch (Platzhalter wie {minimum} blieben uninterpoliert).
import { describe, expect, test } from "bun:test";
import type { FieldIssue } from "@cosmicdrift/kumiko-headless";
import { defaultPrimitives } from "../primitives";
import { render } from "./test-utils";

function renderFieldWithIssues(issues: readonly FieldIssue[]) {
  const { Field } = defaultPrimitives;
  return render(
    <Field id="f" label="Feld" issues={issues} testId="field-under-test">
      <input id="f" />
    </Field>,
  );
}

describe("DefaultField / errors.validation.* i18n", () => {
  test("invalid_format zeigt übersetzten Text statt rohem Key", () => {
    const view = renderFieldWithIssues([
      { path: "startsAt", code: "invalid_format", i18nKey: "errors.validation.invalid_format" },
    ]);
    expect(view.container.textContent).not.toContain("errors.validation");
    expect(view.container.textContent).toContain("Invalid format.");
  });

  test("too_small interpoliert {minimum} aus issue.params", () => {
    const view = renderFieldWithIssues([
      {
        path: "name",
        code: "too_small",
        i18nKey: "errors.validation.too_small",
        params: { minimum: 3 },
      },
    ]);
    expect(view.container.textContent).not.toContain("errors.validation");
    expect(view.container.textContent).not.toContain("{minimum}");
    expect(view.container.textContent).toContain("minimum: 3");
  });

  test("alle Server-/Zod-Codes sind in beiden Default-Bundles übersetzt", async () => {
    const { kumikoDefaultTranslations } = await import("@cosmicdrift/kumiko-renderer");
    const codes = [
      "invalid_type",
      "too_small",
      "too_big",
      "invalid_format",
      "not_multiple_of",
      "unrecognized_keys",
      "invalid_union",
      "invalid_key",
      "invalid_element",
      "invalid_value",
      "custom",
      "unexpected_field",
      "out_of_bounds",
      "invalid_option",
      "failed",
    ];
    for (const locale of ["de", "en"] as const) {
      const bundle = kumikoDefaultTranslations[locale];
      for (const code of codes) {
        expect(bundle?.[`errors.validation.${code}`]).toBeString();
      }
    }
  });
});
