import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../feature.ts";
import { createConfigResolver } from "../resolver.ts";
import { configValuesTable } from "../table.ts";
import { ConfigHandlers, ConfigQueries } from "../web/constants.ts";

const PLAN_NAME = "platform:config:plan-name";
const systemAdmin = TestUsers.systemAdmin;

const platformFeature = defineFeature("platform", (r) => {
  r.requires({ features: ["config"] });
  return r.config({
    keys: {
      planName: createTenantConfig("text", { write: access.systemAdmin, read: access.systemAdmin }),
    },
  });
});

type Values = Record<string, { value: unknown; source: string }>;

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [createConfigFeature(), platformFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });

  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: PLAN_NAME, value: "platform-default", scope: "system" },
    systemAdmin,
  );
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: PLAN_NAME, value: "own-tenant-value", scope: "tenant" },
    systemAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("config:query:values with a read scope", () => {
  test("a SystemAdmin with a tenant row of their own sees the system value on a system-scope read", async () => {
    const res = await stack.http.queryOk<Values>(
      ConfigQueries.values,
      { scope: "system" },
      systemAdmin,
    );

    expect(res[PLAN_NAME]?.value).toBe("platform-default");
    expect(res[PLAN_NAME]?.source).toBe("system-row");
  });

  test("without a read scope the caller's own tenant row still wins", async () => {
    const res = await stack.http.queryOk<Values>(ConfigQueries.values, {}, systemAdmin);

    expect(res[PLAN_NAME]?.value).toBe("own-tenant-value");
  });
});
