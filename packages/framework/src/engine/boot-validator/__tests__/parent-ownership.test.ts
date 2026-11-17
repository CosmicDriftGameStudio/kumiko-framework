// Boot guard for fromParent ownership rules: the reference field must point at the named parent,
// parent and child must be tenant-bound, and the parent chain must be finite.

import { describe, expect, test } from "bun:test";
import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { ParentRule } from "@cosmicdrift/kumiko-types/ownership";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createReferenceField, createTextField } from "../../factories.ts";
import { fromParent } from "../../ownership.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateOwnershipRules } from "../ownership.ts";
import { validateParentOwnershipRules } from "../parent-ownership.ts";

const textField = () => createTextField({ personal: false, reason: "test_fixture" });
const referenceTo = (entity: string) =>
  createReferenceField({ entity, personal: false, reason: "test_fixture" });

const siteEntity = createEntity({
  name: "site",
  table: "read_sites",
  fields: { name: textField() },
});

function childEntity(table: string, fields: Record<string, FieldDefinition>, rule: ParentRule) {
  return createEntity({
    name: table,
    table,
    fields,
    access: {
      read: { Admin: "all", Manager: rule },
      write: { Admin: "all", Manager: rule },
    },
  });
}

function featureWith(entities: Record<string, EntityDefinition>): FeatureDefinition {
  return defineFeature("facilities", (r) => {
    for (const [name, entity] of Object.entries(entities)) r.entity({ ...entity, name });
  });
}

function validate(feature: FeatureDefinition): void {
  validateParentOwnershipRules(feature, new Map([[feature.name, feature]]));
}

describe("validateParentOwnershipRules", () => {
  test("accepts the chain site -> room -> fixture", () => {
    const feature = featureWith({
      site: siteEntity,
      room: childEntity("read_rooms", { siteId: referenceTo("site") }, fromParent("siteId", "site")),
      fixture: childEntity(
        "read_fixtures",
        { roomId: referenceTo("room") },
        fromParent("roomId", "room"),
      ),
    });
    expect(() => validate(feature)).not.toThrow();
  });

  test("rejects a fromParent rule in field-level access", () => {
    const feature = featureWith({
      site: siteEntity,
      room: createEntity({
        name: "room",
        table: "read_rooms",
        fields: {
          siteId: referenceTo("site"),
          secret: createTextField({
            personal: false,
            reason: "test_fixture",
            access: { read: { Manager: fromParent("siteId", "site") } },
          }),
        },
      }),
    });
    expect(() => validateOwnershipRules(feature, undefined, undefined)).toThrow(
      /fromParent.*only valid in an entity-level access map/,
    );
  });

  test("rejects a field that is not a reference to the named entity", () => {
    const feature = featureWith({
      site: siteEntity,
      room: childEntity("read_rooms", { siteId: textField() }, fromParent("siteId", "site")),
    });
    expect(() => validate(feature)).toThrow(/not a single reference field pointing at "site"/);
  });

  test("rejects an unknown parent entity", () => {
    const feature = featureWith({
      room: childEntity("read_rooms", { siteId: referenceTo("site") }, fromParent("siteId", "site")),
    });
    expect(() => validate(feature)).toThrow(/no entity "site" is registered/);
  });

  test("rejects a global parent entity", () => {
    const feature = featureWith({
      site: createEntity({
        name: "site",
        table: "read_sites",
        tenancy: "global",
        fields: { name: textField() },
      }),
      room: childEntity("read_rooms", { siteId: referenceTo("site") }, fromParent("siteId", "site")),
    });
    expect(() => validate(feature)).toThrow(/has tenancy "global"/);
  });

  test("rejects a cycle between two entities", () => {
    const feature = featureWith({
      alpha: childEntity("read_alphas", { betaId: referenceTo("beta") }, fromParent("betaId", "beta")),
      beta: childEntity(
        "read_betas",
        { alphaId: referenceTo("alpha") },
        fromParent("alphaId", "alpha"),
      ),
    });
    expect(() => validate(feature)).toThrow(/alpha -> beta -> alpha/);
  });

  test("rejects a self reference", () => {
    const feature = featureWith({
      node: childEntity("read_nodes", { parentId: referenceTo("node") }, fromParent("parentId", "node")),
    });
    expect(() => validate(feature)).toThrow(/node -> node/);
  });
});
