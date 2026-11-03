import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/index.ts";
import { executorManagedEntitySourceOf } from "../executor-managed-tables.ts";
import { buildEntityTable } from "../table-builder.ts";
import { asEntityTableMeta } from "../table-introspection.ts";

describe("executorManagedEntitySourceOf", () => {
  const entity = createEntity({
    fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
  });
  const table = buildEntityTable("seedProbe", entity);

  test("resolves the entity source from the table", () => {
    expect(executorManagedEntitySourceOf(table)?.entityName).toBe("seedProbe");
  });

  test("resolves the same source from the table meta", () => {
    const meta = asEntityTableMeta(table);
    expect(meta).toBeDefined();
    expect(executorManagedEntitySourceOf(meta)?.entityName).toBe("seedProbe");
  });
});
