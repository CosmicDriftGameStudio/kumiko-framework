import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher, expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../feature.ts";
import { createConfigResolver } from "../resolver.ts";
import { configValuesTable } from "../table.ts";
import { ConfigQueries } from "../web/constants.ts";

const GATE = "validated:config:gate";
const GUARDED = "validated:config:guarded";

const validatedFeature = defineFeature("validated", (r) => {
  r.requires({ features: ["config"] });
  r.config({
    keys: {
      gate: createTenantConfig("text", { default: "open", write: access.roles("Admin") }),
      guarded: createTenantConfig("text", {
        default: "",
        write: access.roles("Admin"),
        validate: async (_value, { readCascade }) => {
          const gate = await readCascade(GATE);
          if (gate.value === "locked") {
            throw new UnprocessableError("test_gate_locked", {
              i18nKey: "validated.errors.notPublic",
            });
          }
        },
      }),
    },
  });
});

let stack: TestStack;
const admin = createTestUser({ id: 98, roles: ["Admin"] });

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [createConfigFeature(), validatedFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function storedValue(key: string): Promise<unknown> {
  const values = await stack.http.queryOk<Record<string, { value: unknown }>>(
    ConfigQueries.values,
    {},
    admin,
  );
  return values[key]?.value;
}

test("validator can read the cascade of another key via readCascade", async () => {
  await stack.http.writeOk("config:write:set", { key: GATE, value: "locked" }, admin);
  const rejected = await stack.http.writeErr(
    "config:write:set",
    { key: GUARDED, value: "x" },
    admin,
  );
  expectErrorIncludes(rejected, "test_gate_locked");
  expect(await storedValue(GUARDED)).toBe("");

  await stack.http.writeOk("config:write:set", { key: GATE, value: "open" }, admin);
  await stack.http.writeOk("config:write:set", { key: GUARDED, value: "x" }, admin);
  expect(await storedValue(GUARDED)).toBe("x");
});
