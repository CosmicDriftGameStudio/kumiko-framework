import { describe, expect, test } from "bun:test";
import { tagAssignmentAggregateId } from "../aggregate-id";

// Drift-Pin-Tests — these values are cross-boot contracts. If they go red:
// stop, think, revert. aggregate-id.ts names this file.

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("tags drift pins", () => {
  test("tag-assignment aggregate-id namespace is stable across boots", () => {
    // TAG_ASSIGNMENT_NAMESPACE is in stone — changing it re-keys every existing
    // assignment stream and breaks event-replay. If this fails: revert the
    // namespace, do not adjust the expected values.
    const base = tagAssignmentAggregateId(TENANT, "tag-1", "credit", "c-1");

    expect(base).toBe(tagAssignmentAggregateId(TENANT, "tag-1", "credit", "c-1")); // deterministic
    // Every tuple component is part of the key (no collisions across the axes).
    expect(base).not.toBe(
      tagAssignmentAggregateId("11111111-1111-1111-1111-111111111111", "tag-1", "credit", "c-1"),
    );
    expect(base).not.toBe(tagAssignmentAggregateId(TENANT, "tag-2", "credit", "c-1"));
    expect(base).not.toBe(tagAssignmentAggregateId(TENANT, "tag-1", "invoice", "c-1"));
    expect(base).not.toBe(tagAssignmentAggregateId(TENANT, "tag-1", "credit", "c-2"));

    // Pinned actual outputs — the drift-detector for the namespace constant.
    expect(base).toBe("4f6e3d2e-033b-57f8-b044-6a3358647f65");
    expect(
      tagAssignmentAggregateId("11111111-1111-1111-1111-111111111111", "tag-1", "credit", "c-1"),
    ).toBe("1bc17669-25ad-565b-9caf-72dbb18756da");
    expect(tagAssignmentAggregateId(TENANT, "tag-2", "credit", "c-1")).toBe(
      "6de1c5c6-25a1-508e-b1f8-de914745406d",
    );
    expect(tagAssignmentAggregateId(TENANT, "tag-1", "invoice", "c-1")).toBe(
      "4e0d68b6-a69b-5dc1-9a2a-cd3f7e8b179d",
    );
    expect(tagAssignmentAggregateId(TENANT, "tag-1", "credit", "c-2")).toBe(
      "659a1f64-31c0-5365-82e6-512fd822f002",
    );
  });

  test("aggregate-id format is a valid uuid", () => {
    expect(tagAssignmentAggregateId(TENANT, "tag-1", "credit", "c-1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
