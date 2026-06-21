import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverApi, TemplateNotFoundError } from "../api";
import { createTemplateResolverFeature } from "../feature";
import { templateResourceEntity } from "../table";
import {
  assertConsumerHandlesMissingResourceKeys,
  assertConsumerHandlesNotFound,
  runTemplateConsumerConformance,
  type TemplateConsumer,
} from "../testing";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

let stack: TestStack;
let db: DbConnection;

const feature = createTemplateResolverFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: conformance harness", () => {
  const conformantConsumer: TemplateConsumer = {
    resolve: (args) => createTemplateResolverApi(db).resolveTemplate(args),
    resolveResources: async (template) => {
      const resolved: Record<string, string> = {};
      for (const key of Object.keys(template.linkedResources)) {
        resolved[key] = `placeholder:${key}`;
      }
      return resolved;
    },
  };

  describe("positive control — direct API consumer", () => {
    runTemplateConsumerConformance(test, conformantConsumer, {
      getDb: () => db,
      tenantId: TENANT_A,
    });
  });

  test("harness detects non-conformant not-found handling", async () => {
    const badConsumer: TemplateConsumer = {
      resolve: async () => {
        throw new Error("generic failure instead of TemplateNotFoundError");
      },
    };

    await expect(
      assertConsumerHandlesNotFound(badConsumer, { getDb: () => db, tenantId: TENANT_A }),
    ).rejects.toThrow("expected TemplateNotFoundError, received Error");
  });

  // 446#1: a consumer whose resolveResources throws a non-TypeError used to
  // fall through the catch and pass — the assertion was effectively a no-op.
  test("harness detects a consumer that throws (non-TypeError) on missing resource keys", async () => {
    const badConsumer: TemplateConsumer = {
      resolve: (args) => createTemplateResolverApi(db).resolveTemplate(args),
      resolveResources: async () => {
        throw new Error("blew up on a missing key instead of degrading");
      },
    };

    await expect(
      assertConsumerHandlesMissingResourceKeys(badConsumer, {
        getDb: () => db,
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow("threw unexpectedly");
  });

  test("conformant consumer propagates TemplateNotFoundError", async () => {
    const apiConsumer: TemplateConsumer = {
      resolve: (args) => createTemplateResolverApi(db).resolveTemplate(args),
    };

    await expect(
      apiConsumer.resolve({
        tenantId: TENANT_A,
        slug: "conformance-not-found-slug",
        kind: "mail-html",
        locale: "de",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });
});
