// fw#2766 — boot guard for join-row entities. The read gate needs the registry,
// which only exists at request time, so the raw executor stays ungated when a
// caller doesn't wire `parentVisibility`. That keeps framework-internal cascade
// and GDPR paths working, and moves enforcement here: a hand-written list/detail
// handler on a parentRef entity must fail boot rather than leak silently.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../define-feature";
import { defineEntityDetailHandler, defineEntityListHandler } from "../../entity-handlers";
import { createEntity, createTextField } from "../../factories";
import type { FeatureDefinition } from "../../types";
import { validateParentRefs } from "../parent-ref";

const textField = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

const hostEntity = createEntity({
  table: "read_hosts",
  fields: { name: textField() },
});

function joinEntity(parentRef: {
  entityTypeField: string;
  entityIdField: string;
  allowedTypes?: readonly string[];
}) {
  return createEntity({
    table: "read_joins",
    fields: { entityType: textField(), entityId: textField() },
    parentRef,
  });
}

const validRef = { entityTypeField: "entityType", entityIdField: "entityId" } as const;

function featureMapOf(...features: readonly FeatureDefinition[]) {
  return new Map(features.map((f) => [f.name, f]));
}

function validate(feature: FeatureDefinition, extra: readonly FeatureDefinition[] = []): void {
  validateParentRefs(feature, featureMapOf(feature, ...extra));
}

describe("validateParentRefs", () => {
  test("accepts a parentRef whose fields exist and whose list/detail are convention handlers", () => {
    const entity = joinEntity(validRef);
    const feature = defineFeature("joins", (r) => {
      r.entity("join", entity);
      r.queryHandler(defineEntityListHandler("join", entity, { access: { openToAll: true } }));
      r.queryHandler(defineEntityDetailHandler("join", entity, { access: { openToAll: true } }));
    });
    expect(() => validate(feature)).not.toThrow();
  });

  test("an entity with no parentRef is not checked at all", () => {
    const feature = defineFeature("plain", (r) => {
      r.entity("host", hostEntity);
      r.queryHandler({
        name: "host:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: true },
      });
    });
    expect(() => validate(feature)).not.toThrow();
  });

  test("rejects an entityTypeField that is not a declared field", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity({ ...validRef, entityTypeField: "nope" }));
    });
    expect(() => validate(feature)).toThrow(/entityTypeField references "nope"/);
  });

  test("rejects an entityIdField that is not a declared field", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity({ ...validRef, entityIdField: "nope" }));
    });
    expect(() => validate(feature)).toThrow(/entityIdField references "nope"/);
  });

  test("rejects an allowedTypes entry that names no registered entity", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity({ ...validRef, allowedTypes: ["ghost"] }));
    });
    expect(() => validate(feature)).toThrow(/names "ghost"/);
  });

  test("accepts an allowedTypes entry registered by another feature", () => {
    const hosts = defineFeature("hosts", (r) => {
      r.entity("host", hostEntity);
    });
    const entity = joinEntity({ ...validRef, allowedTypes: ["host"] });
    const feature = defineFeature("joins", (r) => {
      r.entity("join", entity);
      r.queryHandler(defineEntityListHandler("join", entity, { access: { openToAll: true } }));
    });
    expect(() => validate(feature, [hosts])).not.toThrow();
  });

  test("rejects an allowedTypes host that is itself a join row — no recursive gating", () => {
    const others = defineFeature("others", (r) => {
      r.entity("other", joinEntity(validRef));
    });
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity({ ...validRef, allowedTypes: ["other"] }));
    });
    expect(() => validate(feature, [others])).toThrow(/itself declares a parentRef/);
  });

  test("rejects a hand-written list handler, which would bypass the read gate", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity(validRef));
      r.queryHandler({
        name: "join:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: true },
      });
    });
    expect(() => validate(feature)).toThrow(/join:list/);
  });

  test("rejects a hand-written detail handler too", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity(validRef));
      r.queryHandler({
        name: "join:detail",
        schema: z.object({ id: z.uuid() }),
        handler: async () => null,
        access: { openToAll: true },
      });
    });
    expect(() => validate(feature)).toThrow(/join:detail/);
  });

  test("registering no list/detail handler at all is allowed", () => {
    const feature = defineFeature("joins", (r) => {
      r.entity("join", joinEntity(validRef));
    });
    expect(() => validate(feature)).not.toThrow();
  });
});
