import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  SYSTEM_TENANT_ID,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverHandlers } from "../qualified-names.ts";
import { seedNotificationTemplates } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";

let stack: TestStack;
let db: DbConnection;

function mailerFeature(bodyDe: string) {
  return defineFeature("mailer", (r) => {
    r.writeHandler({
      name: "create",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.notification("welcome-mail", {
      trigger: { on: "create" },
      recipient: () => null,
      data: () => ({}),
      variables: { name: templateVariable.text({ required: true }) },
      template: {
        de: { body: bodyDe },
        en: { body: '<p>Hello <span data-variable="name"></span></p>' },
      },
      meta: { de: { subject: "Willkommen {{name}}" }, en: { subject: "Welcome {{name}}" } },
    });
  });
}

const bodyV1 = '<p>Hallo <span data-variable="name"></span></p>';

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailerFeature(bodyV1),
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const SLUG = "mailer:notify:welcome-mail";

function readRow(locale: string) {
  return fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: SLUG,
    kind: "mail",
    locale,
  });
}

describe("seedNotificationTemplates", () => {
  test("seeds one system mail row per locale with meta and html", async () => {
    await seedNotificationTemplates(db, stack.registry);
    const de = await readRow("de");
    expect(de).toMatchObject({ contentFormat: "html", scope: "system", status: "active" });
    expect(de?.content).toContain('data-variable="name"');
    expect(JSON.parse(de?.meta ?? "null")).toEqual({ subject: "Willkommen {{name}}" });
    expect(JSON.parse((await readRow("en"))?.meta ?? "null")).toEqual({
      subject: "Welcome {{name}}",
    });
  });

  test("a second run writes no new event", async () => {
    const row = await readRow("de");
    const before = await selectMany(db, eventsTable, { aggregateId: String(row?.id) });
    await seedNotificationTemplates(db, stack.registry);
    const after = await selectMany(db, eventsTable, { aggregateId: String(row?.id) });
    expect(after).toHaveLength(before.length);
  });

  test("a re-seed with unchanged text reactivates an archived system row", async () => {
    const archived = await readRow("de");
    await stack.http.writeOk(
      TemplateResolverHandlers.archiveSystem,
      { id: String(archived?.id) },
      TestUsers.systemAdmin,
    );
    expect((await readRow("de"))?.status).toBe("archived");

    await seedNotificationTemplates(db, stack.registry);

    expect((await readRow("de"))?.status).toBe("active");
  });

  test("a changed body in code updates the existing row", async () => {
    const changed = createRegistry([
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailerFeature('<p>Servus <span data-variable="name"></span></p>'),
    ]);
    await seedNotificationTemplates(db, changed);
    expect((await readRow("de"))?.content).toContain("Servus");
  });

  test("templates without the template-resolver feature fail loudly", async () => {
    const withoutResolver = createRegistry([mailerFeature(bodyV1)]);
    await expect(seedNotificationTemplates(db, withoutResolver)).rejects.toThrow(
      /template-resolver/,
    );
  });

  test("templates without a mail renderer plugin fail loudly at seed time", async () => {
    const withoutMailRenderer = createRegistry([
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      mailerFeature(bodyV1),
    ]);
    await expect(seedNotificationTemplates(db, withoutMailRenderer)).rejects.toThrow(
      /renderer plugin for kind "mail"/,
    );
  });

  test("a registry without mail templates is a no-op", async () => {
    await expect(
      seedNotificationTemplates(db, createRegistry([createTemplateResolverFeature()])),
    ).resolves.toBeUndefined();
  });
});
