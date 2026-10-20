import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverHandlers } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(["mail"], ["gate-mailer:notify:hello"]);

const mailer = defineFeature("gate-mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("hello", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: {
      name: templateVariable.text({ required: true }),
      total: templateVariable.money(),
    },
  });
});

const SLUG = "gate-mailer:notify:hello";
const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }), mailer],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const complete = '<p>Hi <span data-variable="name"></span></p>';
const withUnknown = '<p><span data-variable="name"></span> <span data-variable="nope"></span></p>';
const incomplete = "<p>no variables</p>";

function payload(content: string, extra: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    kind: "mail" as const,
    locale: "de",
    content,
    contentFormat: "html" as const,
    meta: { subject: "Hallo {{name}}" },
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

function fieldCodes(err: { details?: unknown }): string[] {
  return (err.details as { fields: Array<{ code: string }> }).fields.map((field) => field.code);
}

describe("template-resolver :: mail gates", () => {
  test("upsertSystem rejects an unknown placeholder", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      payload(withUnknown),
      systemAdmin,
    );
    expect(fieldCodes(err)).toEqual(["unknown_placeholder"]);
  });

  test("upsertSystem rejects a body missing a required variable", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      payload(incomplete, { meta: { subject: "Hallo" } }),
      systemAdmin,
    );
    expect(fieldCodes(err)).toEqual(["missing_required_placeholder"]);
  });

  test("upsertSystem rejects mail without meta and non-html mail", async () => {
    const noMeta = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      payload(complete, { meta: undefined }),
      systemAdmin,
    );
    expect(fieldCodes(noMeta)).toEqual(["invalid_meta"]);
    const markdown = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      payload("# hi", { contentFormat: "markdown" }),
      systemAdmin,
    );
    expect(fieldCodes(markdown)).toEqual(["document_requires_html_format"]);
  });

  test("upsertSystem accepts a complete body", async () => {
    await stack.http.writeOk(TemplateResolverHandlers.upsertSystem, payload(complete), systemAdmin);
  });

  test("a tenant draft may be incomplete and reports it, publish is rejected until fixed", async () => {
    const draft = await stack.http.writeOk<{
      id: string;
      validation: { missingRequired: string[] };
    }>(
      TemplateResolverHandlers.upsertTenant,
      payload(incomplete, { meta: { subject: "Hallo" } }),
      tenantAdmin,
    );
    expect(draft.validation.missingRequired).toEqual(["name"]);

    const rejected = await stack.http.writeErr(
      TemplateResolverHandlers.publish,
      { id: draft.id },
      tenantAdmin,
    );
    expect(fieldCodes(rejected)).toEqual(["missing_required_placeholder"]);

    await stack.http.writeOk(TemplateResolverHandlers.upsertTenant, payload(complete), tenantAdmin);
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id: draft.id }, tenantAdmin);
  });

  test("a tenant draft still rejects unknown placeholders", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      payload(withUnknown, { locale: "en" }),
      tenantAdmin,
    );
    expect(fieldCodes(err)).toEqual(["unknown_placeholder"]);
  });

  test("subject with a line break is rejected as invalid meta", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      payload(complete, { locale: "fr", meta: { subject: "Hi\nBcc: x@y.z" } }),
      systemAdmin,
    );
    expect(fieldCodes(err)).toEqual(["invalid_meta"]);
  });
});
