import { describe, expect, test } from "bun:test";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta";
import { rowMetaFieldNames } from "../table-builder";

// Drift-Guard: LIST_ROW_META_COLUMNS (client-safe subpath, headless's
// computeListViewModel) duplicates the base row-meta column names instead
// of importing db/table-builder directly (that would pull drizzle into the
// client bundle — see ui-types/list-row-meta.ts). This test is the only
// place both sides meet, so a base-columns change here fails loud instead
// of silently drifting the two representations apart.
describe("LIST_ROW_META_COLUMNS ↔ rowMetaFieldNames(false)", () => {
  test("key set matches the non-softDelete base row-meta columns exactly", () => {
    expect(new Set(Object.keys(LIST_ROW_META_COLUMNS))).toEqual(new Set(rowMetaFieldNames(false)));
  });
});
