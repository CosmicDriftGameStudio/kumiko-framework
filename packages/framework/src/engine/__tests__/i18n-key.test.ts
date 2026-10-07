import { expect, test } from "bun:test";
import { i18nKey, isExplicitDotFormKey } from "../i18n-key.js";

test("marks are shared through the global registry, so a second framework copy sees them", () => {
  i18nKey("kumiko.test.shared-mark");

  const registry = (globalThis as Record<symbol, unknown>)[
    Symbol.for("kumiko.i18n.explicitDotFormKeys")
  ];
  expect(registry).toBeInstanceOf(Set);
  expect((registry as Set<string>).has("kumiko.test.shared-mark")).toBe(true);
  expect(isExplicitDotFormKey("kumiko.test.shared-mark")).toBe(true);
  expect(isExplicitDotFormKey("kumiko.test.unmarked")).toBe(false);
});
