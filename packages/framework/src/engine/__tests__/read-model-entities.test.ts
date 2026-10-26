import { describe, expect, test } from "bun:test";
import type { ProjectionDefinition } from "@cosmicdrift/kumiko-types/projection";
import * as z from "zod";
import { integer, type SchemaTable, table, uuid } from "../../db/dialect.ts";
import { resolveAttachedField } from "../../files/create-file-ref.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createFilesField, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

const readTable = table("test_read_model", {
  id: uuid("id").primaryKey(),
  count: integer("count").notNull().default(0),
}) as unknown as SchemaTable;

const mailEntity = createEntity({
  table: "test_read_model",
  fields: {
    subject: createTextField({ personal: false, reason: "test_fixture" }),
    attachments: createFilesField({ personal: false, reason: "test_fixture" }),
  },
});

function projection(overrides: Partial<ProjectionDefinition> = {}): ProjectionDefinition {
  return {
    name: "mail",
    source: "mail",
    table: readTable,
    entity: mailEntity,
    apply: { "mailbox:event:mail-received": async () => {} },
    ...overrides,
  };
}

describe("read-model entities", () => {
  test("a projection entity is addressable as a read model, not as an r.entity", () => {
    const registry = createRegistry([
      defineFeature("mailbox", (r) => {
        r.defineEvent("mail-received", z.object({}), { piiFields: "none" });
        r.projection(projection());
      }),
    ]);

    expect(registry.getReadModelEntity("mail")).toBe(mailEntity);
    expect(registry.getReadModelEntityOwner("mail")).toBe("mailbox");
    expect(registry.getEntity("mail")).toBeUndefined();
  });

  test("an r.entity is never listed as a read model", () => {
    const registry = createRegistry([
      defineFeature("tasks", (r) => {
        r.entity({ name: "task", ...mailEntity });
      }),
    ]);

    expect(registry.getReadModelEntity("task")).toBeUndefined();
  });

  test("two projections declaring an entity for the same source fail the boot", () => {
    const features = [
      defineFeature("mailbox", (r) => {
        r.defineEvent("mail-received", z.object({}), { piiFields: "none" });
        r.projection(projection());
        r.projection(projection({ name: "mail-copy" }));
      }),
    ];

    expect(() => createRegistry(features)).toThrow(/Read-model entity "mail" is declared by two/);
  });

  test("only server-side attach targets resolve a read-model file field", () => {
    const registry = createRegistry([
      defineFeature("mailbox", (r) => {
        r.defineEvent("mail-received", z.object({}), { piiFields: "none" });
        r.projection(projection());
      }),
    ]);

    expect(resolveAttachedField(registry, "mail", "attachments").kind).toBe("unresolvable");
    expect(resolveAttachedField(registry, "mail", "attachments", "entities").kind).toBe(
      "unresolvable",
    );
    expect(
      resolveAttachedField(registry, "mail", "attachments", "entities-and-read-models").kind,
    ).toBe("resolved");
    expect(resolveAttachedField(registry, "mail", "subject", "entities-and-read-models").kind).toBe(
      "unresolvable",
    );
  });
});
