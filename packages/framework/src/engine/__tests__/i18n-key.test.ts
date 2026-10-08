import { afterEach, expect, test } from "bun:test";
import { i18nKey, isExplicitDotFormKey } from "../i18n-key.js";

const REGISTRY_KEY = Symbol.for("kumiko.i18n.explicitDotFormKeys");
const markedInThisFile = new Set<string>();

function sharedRegistry(): Set<string> {
  const registry: unknown = Reflect.get(globalThis, REGISTRY_KEY);
  if (!(registry instanceof Set)) throw new Error("registry missing on globalThis");
  return registry;
}

function mark(value: string): void {
  markedInThisFile.add(value);
  i18nKey(value);
}

// The registry is process-wide, so marks must not outlive the test that made them.
afterEach(() => {
  for (const value of markedInThisFile) sharedRegistry().delete(value);
  markedInThisFile.clear();
});

test("marks are shared through the global registry, so a second framework copy sees them", () => {
  mark("kumiko.test.shared-mark");

  expect(sharedRegistry().has("kumiko.test.shared-mark")).toBe(true);
  expect(isExplicitDotFormKey("kumiko.test.shared-mark")).toBe(true);
  expect(isExplicitDotFormKey("kumiko.test.unmarked")).toBe(false);
});

test("repeated access returns the same Set and sees marks written straight into it", () => {
  mark("kumiko.test.first");
  const before = sharedRegistry();
  mark("kumiko.test.second");

  expect(sharedRegistry()).toBe(before);

  // what a second installed framework copy does: write into the shared Set directly
  markedInThisFile.add("kumiko.test.other-copy");
  before.add("kumiko.test.other-copy");
  expect(isExplicitDotFormKey("kumiko.test.other-copy")).toBe(true);
});

test("marks from earlier tests do not leak, and literal display text stays unmarked", () => {
  expect(isExplicitDotFormKey("kumiko.test.shared-mark")).toBe(false);
  expect(isExplicitDotFormKey("kumiko.test.first")).toBe(false);
  expect(isExplicitDotFormKey("kumiko.test.other-copy")).toBe(false);
  expect(isExplicitDotFormKey("actions.open")).toBe(false);
});
