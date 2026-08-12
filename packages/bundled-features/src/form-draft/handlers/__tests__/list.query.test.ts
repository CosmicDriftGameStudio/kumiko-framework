// byNewestFirst — the sort issue #1960 traced the flake to: form-draft.integration.test.ts
// creates two drafts fast enough to land on the same millisecond savedAt, and the query had
// no ORDER BY at all, so ties fell back to Postgres' undefined row order. These cases can't be
// forced through the integration stack (no clock control on the real save path, and seeding a
// row directly would bypass the event store), so the comparator is unit-tested directly here.

import { describe, expect, test } from "bun:test";
import { byNewestFirst } from "../list.query";

function draft(id: string, savedAt: string) {
  return { id, draftKey: `wizard:${id}`, stepIndex: 0, savedAt };
}

describe("byNewestFirst", () => {
  test("a later savedAt sorts before an earlier one", () => {
    const older = draft("a", "2026-01-01T00:00:00.000Z");
    const newer = draft("b", "2026-01-01T00:00:00.001Z");
    expect([older, newer].sort(byNewestFirst)).toEqual([newer, older]);
  });

  test("a tied savedAt still sorts deterministically, regardless of input order", () => {
    const a = draft("aaaa", "2026-01-01T00:00:00.000Z");
    const b = draft("bbbb", "2026-01-01T00:00:00.000Z");
    expect([a, b].sort(byNewestFirst)).toEqual([b, a].sort(byNewestFirst));
  });
});
