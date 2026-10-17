import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../index.js";
import { createRegistry } from "../registry.js";
import { templateVariable } from "../template-variables.js";
import type { NotificationRecordMapping } from "../types/index.js";

const contactEntity = createEntity({
  table: "record_mapping_contacts",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test fixture" }),
    city: createTextField({ personal: false, reason: "test fixture" }),
  },
});

function contactMailer(
  record: NotificationRecordMapping | undefined,
  options: { readonly withVariables?: boolean } = {},
) {
  return defineFeature("contacts", (r) => {
    r.entity({ name: "contact", ...contactEntity });
    r.writeHandler({
      name: "ping",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.notification("hello", {
      ...(options.withVariables === false
        ? {}
        : { variables: { name: templateVariable.text(), city: templateVariable.text() } }),
      ...(record === undefined ? {} : { record }),
    });
  });
}

describe("r.notification record mapping", () => {
  test("a mapping onto declared variables and entity fields registers", () => {
    const registry = createRegistry([
      contactMailer({ entity: "contact", map: { name: "name", city: "city" } }),
    ]);
    expect(registry.getAllNotifications().get("contacts:notify:hello")?.record).toEqual({
      entity: "contact",
      map: { name: "name", city: "city" },
    });
  });

  test("an unregistered entity is rejected", () => {
    expect(() =>
      createRegistry([contactMailer({ entity: "ghost", map: { name: "name" } })]),
    ).toThrow(/contacts:notify:hello.*entity "ghost" is not registered/);
  });

  test("a mapping without declared variables is rejected", () => {
    expect(() =>
      createRegistry([
        contactMailer({ entity: "contact", map: { name: "name" } }, { withVariables: false }),
      ]),
    ).toThrow(/needs declared variables/);
  });

  test("a mapped key that is no declared variable is rejected", () => {
    expect(() =>
      createRegistry([contactMailer({ entity: "contact", map: { nope: "name" } })]),
    ).toThrow(/"nope" is not a declared variable/);
  });

  test("a path that does not start with an entity field is rejected, id is allowed", () => {
    expect(() =>
      createRegistry([contactMailer({ entity: "contact", map: { name: "missing.deep" } })]),
    ).toThrow(/does not start with a field of entity "contact"/);
    expect(() =>
      createRegistry([contactMailer({ entity: "contact", map: { name: "id" } })]),
    ).not.toThrow();
  });
});
