import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/define-feature";
import { createEntity, createTextField } from "../../engine/factories";
import { createRegistry } from "../../engine/registry";
import { extractTableName, type SchemaTable } from "../dialect";
import { entityTableFromRegistry } from "../entity-table-from-registry";
import { buildEntityTable } from "../table-builder";

function unitEntity() {
  return createEntity({ table: "read_units", fields: { name: createTextField() } });
}

describe("entityTableFromRegistry", () => {
  test("returns the table the registry booted, not one derived from the definition", () => {
    const registry = createRegistry([
      defineFeature("housing", (r) => {
        r.entity("unit", unitEntity());
      }),
    ]);

    const fromRegistry = entityTableFromRegistry(registry, "unit", unitEntity());
    const projection = [...registry.getAllProjections().values()].find(
      (p) => p.isImplicit && p.source === "unit",
    );

    expect(projection).toBeDefined();
    expect(fromRegistry).toBe(projection?.table as SchemaTable);
  });

  // An entity nobody registered has no projection to read — the caller still
  // gets a usable table instead of undefined, which is what made the helper
  // worth having over a raw lookup.
  test("falls back to deriving the table when no implicit projection exists", () => {
    const registry = createRegistry([]);

    const derived = entityTableFromRegistry(registry, "unit", unitEntity());

    expect(extractTableName(derived)).toBe(
      extractTableName(buildEntityTable("unit", unitEntity())),
    );
  });

  // A projection for a different entity must not be handed back: both are
  // implicit, and picking the first one would silently write into the wrong
  // table.
  test("ignores implicit projections of other entities", () => {
    const registry = createRegistry([
      defineFeature("housing", (r) => {
        r.entity("unit", unitEntity());
      }),
    ]);

    const other = createEntity({ table: "read_tenants", fields: { name: createTextField() } });
    const derived = entityTableFromRegistry(registry, "tenant", other);

    expect(extractTableName(derived)).toBe("read_tenants");
  });
});

// Guards the cast in entity-table-from-registry.ts: the helper hands the
// projection's table straight to callers that pass it to selectMany/executors,
// so it has to carry the physical name those consumers read off it.
test("the registry table carries a physical name", () => {
  const registry = createRegistry([
    defineFeature("housing", (r) => {
      r.entity("unit", unitEntity());
    }),
  ]);

  expect(extractTableName(entityTableFromRegistry(registry, "unit", unitEntity()))).toBe(
    "read_units",
  );
});
