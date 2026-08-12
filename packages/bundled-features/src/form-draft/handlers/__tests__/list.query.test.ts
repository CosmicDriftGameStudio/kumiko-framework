import { describe, expect, test } from "bun:test";
import { compareDraftsNewestFirst } from "../list.query";

describe("compareDraftsNewestFirst", () => {
  test("sorts newest savedAt first", () => {
    const drafts = [
      { draftKey: "a", savedAt: "2026-01-01T00:00:00Z" },
      { draftKey: "b", savedAt: "2026-01-03T00:00:00Z" },
      { draftKey: "c", savedAt: "2026-01-02T00:00:00Z" },
    ];
    expect(drafts.toSorted(compareDraftsNewestFirst).map((d) => d.draftKey)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("compares chronologically, not lexically — a locale-sensitive string compare would misorder these", () => {
    // localeCompare on raw ISO strings can rank differently depending on
    // the runtime's collation rules; Instant.compare must always put the
    // later timestamp first regardless of locale.
    const earlier = { draftKey: "x", savedAt: "2026-01-01T09:00:00Z" };
    const later = { draftKey: "y", savedAt: "2026-01-01T10:00:00Z" };
    expect(compareDraftsNewestFirst(later, earlier)).toBeLessThan(0);
    expect(compareDraftsNewestFirst(earlier, later)).toBeGreaterThan(0);
  });

  test("same-instant rows break the tie by draftKey for a deterministic order", () => {
    const drafts = [
      { draftKey: "zebra", savedAt: "2026-01-01T00:00:00Z" },
      { draftKey: "alpha", savedAt: "2026-01-01T00:00:00Z" },
    ];
    expect(drafts.toSorted(compareDraftsNewestFirst).map((d) => d.draftKey)).toEqual([
      "alpha",
      "zebra",
    ]);
  });
});
