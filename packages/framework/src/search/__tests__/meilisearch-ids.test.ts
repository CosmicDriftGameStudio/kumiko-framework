import { describe, expect, test } from "bun:test";
import { meilisearchDocId, meilisearchTenantIndex } from "../meilisearch-adapter";

describe("meilisearchTenantIndex", () => {
  test("prefixes tenant id with t after the index prefix", () => {
    expect(meilisearchTenantIndex("kumiko_", "00000000-0000-4000-8000-000000000001")).toBe(
      "kumiko_t00000000-0000-4000-8000-000000000001",
    );
  });

  test("keeps custom prefixes intact", () => {
    expect(meilisearchTenantIndex("test_abc_", 42 as never)).toBe("test_abc_t42");
  });
});

describe("meilisearchDocId", () => {
  test("joins entity type and id with underscore", () => {
    expect(meilisearchDocId("user", 7)).toBe("user_7");
  });

  test("preserves UUID dashes (legal Meilisearch primary-key chars)", () => {
    expect(meilisearchDocId("order", "a1b2c3d4-e5f6-7890-abcd-ef1234567890" as never)).toBe(
      "order_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  test("sanitizes illegal primary-key characters to underscore", () => {
    expect(meilisearchDocId("note", "a:b/c.d" as never)).toBe("note_a_b_c_d");
  });
});
