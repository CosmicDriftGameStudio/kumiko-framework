import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createReadinessFeature } from "../feature.ts";

// Stack with config, tenant, secrets and readiness mounted; the worker lane runs the probe job on drainJobs().
export async function setupReadinessStack(options: {
  readonly features: readonly FeatureDefinition[];
  readonly extraContext?: Readonly<Record<string, unknown>>;
}): Promise<TestStack> {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createReadinessFeature(),
      ...options.features,
    ],
    jobs: { consumerLane: "worker" },
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
      ...options.extraContext,
    }),
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  return stack;
}

// Marks the current end of the event log; the returned reader lists only events appended after it.
export async function markEvents(stack: TestStack) {
  const known = new Set((await selectMany(stack.db, eventsTable, {})).map((event) => event.id));
  return async () =>
    (await selectMany(stack.db, eventsTable, {}))
      .filter((event) => !known.has(event.id))
      .sort((left, right) => (left.id < right.id ? -1 : 1));
}
