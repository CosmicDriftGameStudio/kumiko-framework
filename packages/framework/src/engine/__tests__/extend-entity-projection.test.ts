// r.extendEntityProjection — registrar/registry contracts (#759). The
// runtime rebuild-replay behaviour is proven in
// custom-fields/__tests__/custom-fields.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";

function exampleEntity(name = "unit") {
  return createEntity({
    table: name,
    fields: { name: createTextField() },
  });
}

const noopApply = async (): Promise<void> => {};

describe("r.extendEntityProjection — registration", () => {
  test("merges apply keys + extraSources into the implicit projection", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }));
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
      r.entity("unit", exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }));
      r.extendEntityProjection("unit", {
        sources: ["unit"],
        apply: { [setEvent.name]: noopApply },
      });
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection?.extraSources).toBeUndefined();
  });

  test("auto-verb of a registered extraSources entity is a valid apply-key", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.entity("field-definition", exampleEntity("field_definitions"));
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
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }));
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
      r.entity("unit", exampleEntity());
    });
    const registry = createRegistry([feature]);
    const projection = registry.getAllProjections().get("test:projection:unit-entity");
    expect(projection?.apply["test:event:custom-field-set"]).toBe(noopApply);
  });

  test("empty apply throws at registration time", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity("unit", exampleEntity());
        r.extendEntityProjection("unit", { apply: {} });
      }),
    ).toThrow(/no apply handlers/);
  });
});

describe("r.extendEntityProjection — registry-build validation", () => {
  test("unknown entity fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }));
      r.extendEntityProjection("typo-entity", { apply: { [setEvent.name]: noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/no r\.entity/);
  });

  test("apply-key collision with a lifecycle apply fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.extendEntityProjection("unit", { apply: { "unit.created": noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/collides/);
  });

  test("apply-key collision between two extensions fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      const setEvent = r.defineEvent("custom-field-set", z.object({ fieldKey: z.string() }));
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
      r.extendEntityProjection("unit", { apply: { [setEvent.name]: noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/collides/);
  });

  test("unknown apply-key (neither auto-verb nor domain event) fails at registry build", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.extendEntityProjection("unit", { apply: { "customField.set": noopApply } });
    });
    expect(() => createRegistry([feature])).toThrow(/no such event/);
  });
});
