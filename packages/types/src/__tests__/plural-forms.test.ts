// Type-level contract for PluralForms (#3344): `other` is the CLDR-mandated
// fallback and must stay required. The body below is never invoked — tsc
// checks it, bun:test does not run it. If `other` ever becomes optional the
// `@ts-expect-error` turns into an "unused directive" compile error.

import { expect, test } from "bun:test";
import type { PluralForms } from "../config.js";

function _pluralFormsRequireOther(): readonly PluralForms[] {
  const withOther: PluralForms = { other: "items" };
  // @ts-expect-error — `other` is required; a plural entry without it must not typecheck.
  const missingOther: PluralForms = { one: "item" };
  return [withOther, missingOther];
}

test("PluralForms: compile-time contract is wired", () => {
  expect(_pluralFormsRequireOther).toBeDefined();
});
