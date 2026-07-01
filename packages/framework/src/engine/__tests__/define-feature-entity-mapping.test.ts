import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

const noteEntity = createEntity({
  table: "dfm_notes",
  fields: { title: createTextField({ required: true }) },
});
const tagEntity = createEntity({
  table: "dfm_tags",
  fields: { label: createTextField({ required: true }) },
});

const bareCreate = {
  name: "create",
  schema: z.object({ title: z.string() }),
  access: { roles: ["User"] },
  handler: async () => ({ isSuccess: true as const, data: {} }),
};

describe("defineFeature — bare CRUD verb → entity mapping", () => {
  test("single-entity fallback maps when the feature name differs from the entity name", () => {
    const f = defineFeature("mynotes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(bareCreate);
    });
    expect(f.handlerEntityMappings?.["create"]).toBe("note");
  });

  test("feature-name match wins (the fallback is the secondary path)", () => {
    // Two entities (516/1): with only "note" registered, this would also
    // pass via the single-entity fallback, proving nothing about the
    // name-match branch specifically. A second entity ("tag") disables the
    // fallback (entityKeys.length !== 1), so success here can only come
    // from entities[name] matching — the branch this test claims to cover.
    const f = defineFeature("note", (r) => {
      r.entity("note", noteEntity);
      r.entity("tag", tagEntity);
      r.writeHandler(bareCreate);
    });
    expect(f.handlerEntityMappings?.["create"]).toBe("note");
  });

  test("no fallback when the feature owns more than one entity", () => {
    const f = defineFeature("mixed", (r) => {
      r.entity("note", noteEntity);
      r.entity("tag", tagEntity);
      r.writeHandler(bareCreate);
    });
    expect(f.handlerEntityMappings?.["create"]).toBeUndefined();
  });
});
