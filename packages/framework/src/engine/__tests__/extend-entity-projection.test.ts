// r.extendEntityProjection — registrar/registry contracts. The
// runtime rebuild-replay behaviour is proven in
// custom-fields/__tests__/custom-fields.integration.test.ts.

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildEntityTable } from "../../db/table-builder.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

function exampleEntity(name = "unit") {
  return createEntity({
    name: "unit",
    table: name,
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
  });
}

const noopApply = async (): Promise<void> => {};
const derivedRowId = (source: { readonly aggregateId: string }): string => source.aggregateId;
const otherDerivedRowId = (source: { readonly aggregateId: string }): string => source.aggregateId;

describe("r.extendEntityProjection — registration", () => {
  test("merges apply keys + extraSources into the implicit projection", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        apply: { [setEvent.name]: noopApply },
      });
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection).toBeDefined();
    expect(projection?.apply["test:event:custom-field-set"]).toBe(noopApply);
    expect(projection?.apply["unit.created"]).toBeDefined();
    expect(projection?.extraSources).toEqual(["field-definition"]);
    expect(projection?.source).toBe("unit");
  });

  test("extension source equal to the entity name is not duplicated into extraSources", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["unit"],
        apply: { [setEvent.name]: noopApply },
      });
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection?.extraSources).toBeUndefined();
  });

  test("rowIdOf maps each of the extension's sources into extraSourceRowIds", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition", "other-stream"],
        rowIdOf: derivedRowId,
        apply: { [setEvent.name]: noopApply },
      });
    });
    const projection = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity");
    expect(projection?.extraSourceRowIds).toEqual({
      "field-definition": derivedRowId,
      "other-stream": derivedRowId,
    });
  });

  test("no extraSourceRowIds on the definition when no extension declares rowIdOf", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        apply: { [setEvent.name]: noopApply },
      });
    });
    const projection = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity");
    expect(projection?.extraSourceRowIds).toBeUndefined();
  });

  test("auto-verb of a registered extraSources entity is a valid apply-key", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      r.entity({ ...exampleEntity("field_definitions"), name: "field-definition" });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        apply: { "field-definition.deleted": noopApply },
      });
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection?.apply["field-definition.deleted"]).toBe(noopApply);
  });

  test("registration order is free: extension before r.entity in the same feature", () => {
    const feature = defineFeature("test", (r) => {
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
      r.entity(exampleEntity());
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection?.apply["test:event:custom-field-set"]).toBe(noopApply);
  });

  test("empty apply throws at registration time", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity(exampleEntity());
        r.extendEntityProjection("unit", { apply: {} });
      }),
    ).toThrow(/no apply handlers/);
  });
});

describe("r.extendEntityProjection — registry-build validation", () => {
  test("unknown entity fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("typo-entity", { apply: { [setEvent.name]: noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/no r\.entity/);
  });

  test("apply-key collision with a lifecycle apply fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      r.extendEntityProjection("unit", { apply: { "unit.created": noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/collides/);
  });

  test("apply-key collision between two extensions fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/collides/);
  });

  test("unknown apply-key (neither auto-verb nor domain event) fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      r.extendEntityProjection("unit", { apply: { "customField.set": noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/no such event/);
  });

  test("rowIdOf without sources fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        rowIdOf: derivedRowId,
        apply: { [setEvent.name]: noopApply },
      });
    });
    expect(() => createRegistry([feature])).toThrow(/rowIdOf without `sources`/);
  });

  test("rowIdOf on the entity's own stream fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["unit"],
        rowIdOf: derivedRowId,
        apply: { [setEvent.name]: noopApply },
      });
    });
    expect(() => createRegistry([feature])).toThrow(/own stream "unit"/);
  });

  test("a source shared with a different rowIdOf fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const firstEvent = r.defineEvent("first-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      const secondEvent = r.defineEvent("second-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        rowIdOf: derivedRowId,
        apply: { [firstEvent.name]: noopApply },
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        rowIdOf: otherDerivedRowId,
        apply: { [secondEvent.name]: noopApply },
      });
    });
    expect(() => createRegistry([feature])).toThrow(/ambiguous/);
  });

  test("a source shared with an extension lacking rowIdOf fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(exampleEntity());
      const firstEvent = r.defineEvent("first-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      const secondEvent = r.defineEvent("second-set", z.object({ fieldKey: z.string() }), {
        piiFields: "none",
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        apply: { [firstEvent.name]: noopApply },
      });
      r.extendEntityProjection("unit", {
        sources: ["field-definition"],
        rowIdOf: derivedRowId,
        apply: { [secondEvent.name]: noopApply },
      });
    });
    expect(() => createRegistry([feature])).toThrow(/ambiguous/);
  });
});

describe("explicit r.projection on the entity table", () => {
  const unitEntity = exampleEntity();
  const unitTable = buildEntityTable(unitEntity);

  test("merges apply and foreign sources into the implicit projection", () => {
    const fnA = async (): Promise<void> => {};
    const feature = defineFeature("test", (r) => {
      r.entity(unitEntity);
      const closed = r.defineEvent("unit-closed", z.object({}), { piiFields: "none" });
      r.projection({
        name: "unit-status",
        source: ["unit", "other-agg"],
        table: unitTable,
        apply: { [closed.name]: fnA },
      });
    });
    const projection = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity");
    expect(projection?.apply["test:event:unit-closed"]).toBe(fnA);
    expect(projection?.extraSources).toContain("other-agg");
    expect(projection?.extraSources).not.toContain("unit");
  });

  test("same key on two explicit projections runs both in registration order", async () => {
    const calls: string[] = [];
    const feature = defineFeature("test", (r) => {
      r.entity(unitEntity);
      const closed = r.defineEvent("unit-closed", z.object({}), { piiFields: "none" });
      r.projection({
        name: "unit-status-a",
        source: "unit",
        table: unitTable,
        apply: {
          [closed.name]: async () => {
            calls.push("a");
          },
        },
      });
      r.projection({
        name: "unit-status-b",
        source: "unit",
        table: unitTable,
        apply: {
          [closed.name]: async () => {
            calls.push("b");
          },
        },
      });
    });
    const merged = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity")?.apply["test:event:unit-closed"];
    expect(merged).toBeDefined();
    // The test applies ignore their arguments, so no event or transaction is needed.
    await Reflect.apply(merged ?? noopApply, undefined, []);
    expect(calls).toEqual(["a", "b"]);
  });

  test("an extendEntityProjection key wins over the same key on an explicit projection", () => {
    const extFn = async (): Promise<void> => {};
    const fnA = async (): Promise<void> => {};
    const feature = defineFeature("test", (r) => {
      r.entity(unitEntity);
      r.defineEvent("unit-closed", z.object({}), { piiFields: "none" });
      r.extendEntityProjection("unit", { apply: { "test:event:unit-closed": extFn } });
      r.projection({
        name: "unit-status",
        source: "unit",
        table: unitTable,
        apply: { "test:event:unit-closed": fnA },
      });
    });
    const projection = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity");
    expect(projection?.apply["test:event:unit-closed"]).toBe(extFn);
  });

  test("a projection on another table is not merged", () => {
    const fnA = async (): Promise<void> => {};
    const otherEntity = exampleEntity("other_units");
    const feature = defineFeature("test", (r) => {
      r.entity(unitEntity);
      const closed = r.defineEvent("unit-closed", z.object({}), { piiFields: "none" });
      r.projection({
        name: "other-status",
        source: "unit",
        table: buildEntityTable({ ...otherEntity, name: "other-unit" }),
        apply: { [closed.name]: fnA },
      });
    });
    const projection = createRegistry([feature])
      .getAllProjections()
      .get("test:projection:unit-entity");
    expect(projection?.apply["test:event:unit-closed"]).toBeUndefined();
  });
});
