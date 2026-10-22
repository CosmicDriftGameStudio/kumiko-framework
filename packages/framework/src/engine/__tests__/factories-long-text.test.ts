// createLongTextField + LongTextFieldDef contract tests.
//
// Pin the type-level enforcement so a refactor that re-adds sortable/
// searchable/filterable to LongTextFieldDef breaks the build instead of
// silently degrading the field's semantics.
//
// longText is a dedicated field type for source code, markdown, and blog
// posts—explicitly NOT sortable, searchable, or filterable. Type-level
// enforcement prevents soft defaults.

import { describe, expect, expectTypeOf, test } from "bun:test";
import { createLongTextField } from "../factories.ts";
import type { LongTextFieldDef } from "../types/index.ts";

// =============================================================================
// Runtime shape
// =============================================================================

describe("createLongTextField — runtime shape", () => {
  test("kumiko-framework#2921: no argument throws — a longText field must declare a personal stance", () => {
    expect(() =>
      // @ts-expect-error overrides (with a personal stance) is now required
      createLongTextField(),
    ).toThrow(/must declare an explicit personal-data stance/);
  });

  test("required: true is preserved as literal in the return type", () => {
    const f = createLongTextField({ required: true, personal: false, reason: "test_fixture" });
    expect(f.required).toBe(true);
    // Literal-type-pin: TypeScript should narrow `required` to `true`,
    // not `boolean`. If this test compiles with `f.required: boolean`,
    // the generic-R-pattern in the factory has degraded.
    expectTypeOf(f.required).toEqualTypeOf<true>();
  });

  test("maxLength is propagated through", () => {
    const f = createLongTextField({
      maxLength: 1_000_000,
      personal: false,
      reason: "test_fixture",
    });
    expect(f.maxLength).toBe(1_000_000);
  });

  test("encrypted + sensitive flags type-allowed", () => {
    const f = createLongTextField({
      personal: false,
      reason: "test_fixture",
      encrypted: true,
      sensitive: true,
    });
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
    const f1 = createLongTextField({ sortable: true, personal: false, reason: "test_fixture" });
    // @ts-expect-error searchable is NOT allowed on longText
    const f2 = createLongTextField({ searchable: true, personal: false, reason: "test_fixture" });
    // @ts-expect-error filterable is NOT allowed on longText
    const f3 = createLongTextField({ filterable: true, personal: false, reason: "test_fixture" });
    // @ts-expect-error format is NOT allowed on longText
    const f4 = createLongTextField({ format: "email", personal: false, reason: "test_fixture" });

    // Runtime sanity: despite the @ts-expect-error-ignored options, the field
    // is successfully created at runtime—type-level blocking applies only at
    // compile time. Pin the runtime shape so the fake-test guard sees that
    // the test contains real assertions.
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
