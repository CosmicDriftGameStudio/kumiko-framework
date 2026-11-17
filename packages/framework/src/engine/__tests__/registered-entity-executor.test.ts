import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntityExecutor } from "../entity-handlers.ts";
import { createEntity, createRegistry, defineFeature, registeredEntityExecutor } from "../index.ts";

function registryWithNote() {
  return createRegistry([
    defineFeature("notes", (r) => {
      r.entity(createEntity({ name: "note", table: "notes", fields: {} }));
    }),
  ]);
}

describe("registeredEntityExecutor", () => {
  test("returns undefined for an entity no feature registered", () => {
    expect(registeredEntityExecutor(registryWithNote(), "missing")).toBeUndefined();
  });

  test("reuses one executor per registered entity", () => {
    const registry = registryWithNote();
    const first = registeredEntityExecutor(registry, "note");
    expect(first).not.toBeUndefined();
    expect(registeredEntityExecutor(registry, "note")).toBe(first);
  });

  test("builds separate executors for different definitions under the same name", () => {
    const first = registeredEntityExecutor(registryWithNote(), "note");
    const second = registeredEntityExecutor(registryWithNote(), "note");
    expect(first).not.toBeUndefined();
    expect(second).not.toBe(first);
  });
});

describe("createEntityExecutor", () => {
  test("createEntityExecutor(entity) takes the table name from entity.name", () => {
    const entity = createEntity({ name: "memo", fields: {} });
    const { table } = createEntityExecutor(entity);
    expect(getTableName(table)).toBe(getTableName(buildEntityTable(entity)));
  });
});
