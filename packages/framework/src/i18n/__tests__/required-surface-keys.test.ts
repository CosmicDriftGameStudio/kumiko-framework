import { describe, expect, test } from "bun:test";
import { booleanFacetOptionKeys, selectFacetOptionKey } from "../required-surface-keys";

describe("required-surface-keys helpers", () => {
  test("booleanFacetOptionKeys emits true/false option keys", () => {
    expect(booleanFacetOptionKeys("tenant", "tenant", "isEnabled")).toEqual([
      "tenant:entity:tenant:field:isEnabled:option:true",
      "tenant:entity:tenant:field:isEnabled:option:false",
    ]);
  });

  test("selectFacetOptionKey encodes option value", () => {
    expect(selectFacetOptionKey("user", "user", "status", "active")).toBe(
      "user:entity:user:field:status:option:active",
    );
  });
});
