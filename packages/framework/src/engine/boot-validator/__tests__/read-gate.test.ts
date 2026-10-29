import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "../../../files/file-ref-entity.ts";
import { defineFeature } from "../../define-feature.ts";
import { defineEntityListHandler } from "../../entity-handlers.ts";
import { createEntity, createFileField, createTextField } from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateReadGates } from "../read-gate.ts";

const text = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

const linkEntity = createEntity({
  table: "read_gate_boot_links",
  fields: { documentId: text(), entityType: text(), entityId: text() },
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
});

function gated(readGate: EntityDefinition["readGate"], extra: Partial<EntityDefinition> = {}) {
  return createEntity({
    table: "read_gate_boot_docs",
    fields: { title: text(), file: createFileField() },
    ...(readGate !== undefined && { readGate }),
    ...extra,
  });
}

const validGate = {
  anyLink: { entity: "link", field: "documentId" },
  fileOwner: { field: "file" },
} as const;

function check(docEntity: EntityDefinition, withFiles = true, handwrittenList = false): void {
  const docs = defineFeature("docs", (r) => {
    r.entity({ name: "doc", ...docEntity });
    r.entity({ name: "link", ...linkEntity });
    if (handwrittenList) {
      r.queryHandler({
        name: "doc:list",
        schema: z.object({}),
        handler: async () => [],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    }
  });
  const files = defineFeature("files-stub", (r) => {
    r.entity({ name: FILE_REF_ENTITY_NAME, ...fileRefEntity });
  });
  const features: FeatureDefinition[] = withFiles ? [docs, files] : [docs];
  validateReadGates(docs, new Map(features.map((f) => [f.name, f] as const)));
}

describe("validateReadGates", () => {
  test("accepts a gate naming a registered link entity and a file field", () => {
    expect(() => check(gated(validGate))).not.toThrow();
  });

  test("rejects a gate combined with parentRef", () => {
    const entity = gated(validGate, {
      parentRef: { entityTypeField: "title", entityIdField: "title" },
    });
    expect(() => check(entity)).toThrow(/cannot be combined/);
  });

  test("rejects an unregistered link entity, a link without parentRef and an unknown link field", () => {
    expect(() => check(gated({ anyLink: { entity: "ghost", field: "documentId" } }))).toThrow(
      /not registered/,
    );
    expect(() => check(gated({ anyLink: { entity: "doc", field: "title" } }))).toThrow(
      /must declare a parentRef/,
    );
    expect(() => check(gated({ anyLink: { entity: "link", field: "nope" } }))).toThrow(
      /not a field/,
    );
  });

  test("rejects a file-owner field that is not a file field, or a stack without the files feature", () => {
    expect(() => check(gated({ fileOwner: { field: "title" } }))).toThrow(/single file or image/);
    expect(() => check(gated({ fileOwner: { field: "file" } }), false)).toThrow(/files feature/);
  });

  test("rejects a hand-written list handler that would bypass the gate", () => {
    expect(() => check(gated(validGate), true, true)).toThrow(/bypass the readGate/);
  });

  test("accepts the convention list handler", () => {
    const docEntity = gated(validGate);
    const docs = defineFeature("docs", (r) => {
      r.entity({ name: "doc", ...docEntity });
      r.entity({ name: "link", ...linkEntity });
      r.queryHandler(
        defineEntityListHandler("doc", docEntity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
    });
    const files = defineFeature("files-stub", (r) => {
      r.entity({ name: FILE_REF_ENTITY_NAME, ...fileRefEntity });
    });
    expect(() =>
      validateReadGates(docs, new Map([docs, files].map((f) => [f.name, f] as const))),
    ).not.toThrow();
  });
});
