// createLongTextField + LongTextFieldDef contract tests.
//
// Pin the type-level enforcement so a refactor that re-adds sortable/
// searchable/filterable to LongTextFieldDef breaks the build, not
// silently degrades the field's semantics.
//
// Sprint-5b-vorab introduced longText as a dedicated field-type for
// source-code / markdown / blog-posts — explicitly NOT sortable /
// searchable / filterable. Type-level enforcement statt soft-defaults.

import { describe, expect, expectTypeOf, test } from "bun:test";
import { createLongTextField } from "../factories";
import type { LongTextFieldDef } from "../types";

// =============================================================================
// Runtime shape
// =============================================================================

describe("createLongTextField — runtime shape", () => {
  test("default returns { type: 'longText', required: false }", () => {
    const f = createLongTextField();
    expect(f).toEqual({ type: "longText", required: false });
  });

  test("required: true is preserved as literal in the return type", () => {
    const f = createLongTextField({ required: true });
    expect(f.required).toBe(true);
    // Literal-type-pin: TypeScript should narrow `required` to `true`,
    // not `boolean`. If this test compiles with `f.required: boolean`,
    // the generic-R-pattern in the factory has degraded.
    expectTypeOf(f.required).toEqualTypeOf<true>();
  });

  test("maxLength is propagated through", () => {
    const f = createLongTextField({ maxLength: 1_000_000 });
    expect(f.maxLength).toBe(1_000_000);
  });

  test("encrypted + sensitive flags type-allowed", () => {
    const f = createLongTextField({ encrypted: true, sensitive: true });
    expect(f.encrypted).toBe(true);
    expect(f.sensitive).toBe(true);
  });
});

// =============================================================================
// Type-level enforcement — these MUST be ts-errors, not runtime-rejected
// =============================================================================

describe("LongTextFieldDef — type-level non-indexable enforcement", () => {
  test("sortable / searchable / filterable / format are NOT in the type", () => {
    // The point of longText is type-level rejection of these flags
    // (they don't exist in the discriminated-union variant). This
    // test pins it via @ts-expect-error: if someone adds `sortable`
    // back to LongTextFieldDef, the @ts-expect-error fails (because
    // the call would suddenly type-check), turning the test red.
    // @ts-expect-error sortable is NOT allowed on longText
    const f1 = createLongTextField({ sortable: true });
    // @ts-expect-error searchable is NOT allowed on longText
    const f2 = createLongTextField({ searchable: true });
    // @ts-expect-error filterable is NOT allowed on longText
    const f3 = createLongTextField({ filterable: true });
    // @ts-expect-error format is NOT allowed on longText
    const f4 = createLongTextField({ format: "email" });

    // Runtime sanity: trotz der @ts-expect-error-ignored options ist
    // das field zur Laufzeit erfolgreich erzeugt — type-level-blockade
    // wirkt nur compile-time. Wir pinnen den runtime-shape damit der
    // Fake-Test-Guard sieht dass der test echte assertions hat.
    for (const f of [f1, f2, f3, f4]) {
      expect(f.type).toBe("longText");
      expect(f.required).toBe(false);
    }
  });

  test("LongTextFieldDef.type is the literal 'longText'", () => {
    // Drift-pin: if the type-string ever changes, dispatch-sites in
    // table-builder / schema-builder / event-store-executor / e2e-
    // generator break — but they'd only break at the next entity-using-
    // longText runtime. This test pins the literal at compile-time.
    const t: LongTextFieldDef["type"] = "longText";
    expect(t).toBe("longText");
  });
});
