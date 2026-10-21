import { describe, expect, test } from "bun:test";
import { createEntity, createNumberField, createTextField } from "../../engine/index.ts";
import { buildDistinctOnClause, extractTableInfo, selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";

const docEntity = createEntity({
  table: "read_distinct_on_units",
  fields: {
    key: createTextField({ personal: false, reason: "technical_reference", required: true }),
    revision: createNumberField({ required: true }),
  },
});
const info = extractTableInfo(buildEntityTable("distinct-on-unit", docEntity));

describe("buildDistinctOnClause", () => {
  test("returns undefined without distinctOn", () => {
    expect(buildDistinctOnClause(info, undefined, [{ col: "revision" }])).toBeUndefined();
  });

  test("defaults ORDER BY to the distinctOn columns ascending", () => {
    const clause = buildDistinctOnClause(info, ["key"], undefined);
    expect(clause?.selectPrefix).toBe('DISTINCT ON ("key") ');
    expect(clause?.orderBy).toEqual([{ col: "key" }]);
  });

  test("keeps a caller orderBy that starts with the distinctOn fields", () => {
    const orderBy = [{ col: "key" }, { col: "revision", direction: "desc" as const }];
    expect(buildDistinctOnClause(info, ["key"], orderBy)?.orderBy).toEqual(orderBy);
  });

  test("throws on an unknown column", () => {
    expect(() => buildDistinctOnClause(info, ["nope"], undefined)).toThrow(
      /distinctOn entry "nope" is not a column/,
    );
  });

  test("throws when orderBy does not start with the distinctOn fields", () => {
    expect(() => buildDistinctOnClause(info, ["key"], [{ col: "revision" }])).toThrow(
      /orderBy must start with the distinctOn fields \[key\]/,
    );
    expect(() => buildDistinctOnClause(info, ["key"], [])).toThrow(/orderBy must start/);
  });

  test("selectMany rejects before touching the database", async () => {
    const table = buildEntityTable("distinct-on-unit", docEntity);
    await expect(
      selectMany({}, table, {}, { distinctOn: ["key"], orderBy: { col: "revision" } }),
    ).rejects.toThrow(/orderBy must start/);
  });
});
