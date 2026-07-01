import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import type { RendererContext } from "../../renderer-foundation";
import { SYSTEM_TENANT_ID } from "../../template-resolver/constants";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table";
import { adaptToFoundation } from "../feature";

let stack: TestStack;
let db: DbConnection;

const TENANT_ID = "11111111-1111-4111-8111-111111111111" as TenantId;

const templateResolverFeature = createTemplateResolverFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [templateResolverFeature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function rendererCtx(): RendererContext {
  return { db, registry: stack.registry, tenantId: TENANT_ID };
}

async function seedPlainNotificationTemplate(content: string): Promise<void> {
  await insertOne(db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "welcome-mail",
    kind: "notification",
    locale: "de",
    scope: "system",
    status: "active",
    content,
    contentFormat: "plain",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    createdBy: "test",
    updatedBy: "test",
  });
}

describe("renderer-simple :: template-resolver integration", () => {
  test("resolves slug via template-resolver and merges runtime variables", async () => {
    await seedPlainNotificationTemplate(
      JSON.stringify({
        header: "Template header",
        sections: [{ text: "Template body" }],
      }),
    );

    const res = await adaptToFoundation(
      {
        kind: "notification",
        payload: {
          template: "welcome-mail",
          locale: "de",
          variables: { header: "Runtime override" },
        },
      },
      rendererCtx(),
    );

    expect(res.kind).toBe("notification");
    if (res.kind === "notification") {
      expect(res.html).toContain("Runtime override");
      expect(res.html).toContain("Template body");
      expect(res.html).not.toContain("Template header");
    }
  });

  test("falls back to variables when slug is unknown in template-resolver", async () => {
    const res = await adaptToFoundation(
      {
        kind: "notification",
        payload: {
          template: "password-reset",
          variables: { title: "Reset", body: "Click the link" },
        },
      },
      rendererCtx(),
    );

    expect(res.kind).toBe("notification");
    if (res.kind === "notification") {
      expect(res.html).toContain("Reset");
      expect(res.html).toContain("Click the link");
    }
  });
});
