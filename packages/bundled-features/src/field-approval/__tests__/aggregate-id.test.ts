import { describe, expect, test } from "bun:test";
import { fieldChangeRequestAggregateId } from "../aggregate-id.ts";

// Drift pins: these values are cross-boot contracts. If they go red: stop, think, revert.
// aggregate-id.ts names this file.

const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "11111111-1111-1111-1111-111111111111";

describe("field-approval drift pins", () => {
  test("field-change-request aggregate-id namespace is stable across boots", () => {
    // Changing the namespace re-keys every existing request stream. If this fails: revert the
    // namespace, do not adjust the expected values.
    const base = fieldChangeRequestAggregateId(TENANT, "contact", "c-1", "iban");

    expect(base).toBe("ed0d2ba5-cc27-51f5-83ad-17d98fe4336f");
    expect(fieldChangeRequestAggregateId(OTHER_TENANT, "contact", "c-1", "iban")).toBe(
      "1ab5d401-e2c7-5b46-8b88-8818a38bd7c5",
    );
    expect(fieldChangeRequestAggregateId(TENANT, "owner", "c-1", "iban")).toBe(
      "be8e68a2-56c3-5a7b-b985-63b24a80b911",
    );
    expect(fieldChangeRequestAggregateId(TENANT, "contact", "c-2", "iban")).toBe(
      "06492b8a-1dfb-5a9d-8487-24f9a189dc75",
    );
    expect(fieldChangeRequestAggregateId(TENANT, "contact", "c-1", "bic")).toBe(
      "88dfd164-d75a-505a-98e8-352edaa269ae",
    );
  });
});
