import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  type ConfigCascade,
  createSystemConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { createSecretsContext } from "../../secrets/secrets-context";
import { tenantSecretsTable } from "../../secrets/table";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

// Proves the generic backing="secrets" dispatch end-to-end over real HTTP:
// a system-scoped config key with backing:"secrets" stores/reads/clears through
// the secrets store (envelope-encrypted, system tenant) instead of the
// config_values projection — while the value is masked in the query handlers
// yet revealed for the owning feature's internal ctx.config read.

const SYSTEM_TENANT = "00000000-0000-4000-8000-000000000000";
const API_KEY = "billing:config:api-key";
const PLAIN_KEY = "billing:config:webhook-path";

const systemAdmin = TestUsers.systemAdmin; // roles ["SystemAdmin"]

const billingFeature = defineFeature("billing", (r) => {
  r.requires("config");
  r.config({
    keys: {
      // backing:"secrets" — value lives in the secrets store, not config_values.
      apiKey: createSystemConfig("text", {
        backing: "secrets",
        write: access.systemAdmin,
        read: access.admin,
      }),
      // Control: a plain system config key (config_values, no secrets dispatch).
      webhookPath: createSystemConfig("text", {
        default: "/hooks",
        write: access.systemAdmin,
        read: access.admin,
      }),
    },
  });
  // Internal-read probe: a handler that reads its own secrets-backed key via
  // ctx.config — must receive the revealed plaintext, not the mask.
  r.queryHandler(
    "peek-api-key",
    z.object({}),
    async (_query, ctx) => {
      if (!ctx.config) throw new Error("ctx.config not wired");
      return { value: await ctx.config(API_KEY) };
    },
    { access: { roles: ["SystemAdmin"] } },
  );
});

let stack: TestStack;

beforeAll(async () => {
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createConfigFeature(), billingFeature],
    extraContext: ({ db, registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
        secrets: createSecretsContext({ db, masterKeyProvider }),
      };
    },
  });
  await unsafePushTables(stack.db, { configValuesTable, tenantSecretsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

type Cascades = Record<string, ConfigCascade>;

describe("config backing=secrets — write dispatch", () => {
  test("set routes the value into the secrets store, not config_values", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: API_KEY, value: "sk-live-abc123", scope: "system" },
      systemAdmin,
    );

    const secretRows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: SYSTEM_TENANT,
      key: API_KEY,
    });
    expect(secretRows).toHaveLength(1);

    const configRows = await selectMany(stack.db, configValuesTable, { key: API_KEY });
    expect(configRows).toHaveLength(0);
  });

  test("the stored secret is an envelope, never the plaintext", async () => {
    const [row] = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: SYSTEM_TENANT,
      key: API_KEY,
    });
    // No column of the stored row may carry the plaintext — the secrets
    // envelope must have encrypted it.
    expect(JSON.stringify(row)).not.toContain("sk-live-abc123");
  });
});

describe("config backing=secrets — read dispatch", () => {
  test("the owning feature reads the revealed plaintext via ctx.config", async () => {
    const res = await stack.http.queryOk<{ value: unknown }>(
      "billing:query:peek-api-key",
      {},
      systemAdmin,
    );
    // JSON round-trip: set serialized "sk-live-abc123" → resolver reveals +
    // deserializes back to the original string.
    expect(res.value).toBe("sk-live-abc123");
  });

  test("config:query:cascade masks the value AND every level", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [API_KEY] },
      systemAdmin,
    );
    const cascade = res[API_KEY];
    expect(cascade?.value).toBe("••••••");
    expect(cascade?.source).toBe("system-row");
    const systemLevel = cascade?.levels.find((l) => l.source === "system-row");
    expect(systemLevel?.hasValue).toBe(true);
    expect(systemLevel?.value).toBe("••••••");
    expect(JSON.stringify(cascade)).not.toContain("sk-live-abc123");
  });

  test("config:query:values masks the value", async () => {
    const res = await stack.http.queryOk<Record<string, { value: unknown; source: string }>>(
      ConfigQueries.values,
      {},
      systemAdmin,
    );
    expect(res[API_KEY]?.value).toBe("••••••");
    expect(res[API_KEY]?.source).toBe("system-row");
    // The plain control key still resolves transparently.
    expect(res[PLAIN_KEY]?.value).toBe("/hooks");
    expect(res[PLAIN_KEY]?.source).toBe("default");
  });
});

describe("config backing=secrets — fail-loud when secrets unwired", () => {
  // The PR's central safety promise: a backing="secrets" key throws loudly at
  // request time when ctx.secrets is absent — it never silently degrades into
  // a config_values write. One write exercises the set.write throw site; the
  // resolver and reset.write guards share the identical `!ctx.secrets` shape.
  test("set on a backing=secrets key throws internal_error when ctx.secrets is absent", async () => {
    const unwired = await setupTestStack({
      features: [createConfigFeature(), billingFeature],
      extraContext: ({ registry }) => {
        const resolver = createConfigResolver();
        return {
          configResolver: resolver,
          _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
          // No `secrets` — the backing="secrets" path must fail loudly.
        };
      },
    });
    await unsafePushTables(unwired.db, { configValuesTable, tenantSecretsTable });
    await createEventsTable(unwired.db);

    try {
      const err = await unwired.http.writeErr(
        ConfigHandlers.set,
        { key: API_KEY, value: "sk-live-should-not-persist", scope: "system" },
        systemAdmin,
      );
      expect(err.code).toBe("internal_error");
      expect(err.httpStatus).toBe(500);

      // It must NOT have silently fallen back to a config_values row.
      const configRows = await selectMany(unwired.db, configValuesTable, { key: API_KEY });
      expect(configRows).toHaveLength(0);
    } finally {
      await unwired.cleanup();
    }
  });

  test("cascade read on backing=secrets without secretsReader throws", async () => {
    // Write succeeds on the wired stack; then resolve via a bare resolver
    // (no secretsReader) so readBackingSecret fails loud on the cascade path.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: API_KEY, value: "sk-live-planted", scope: "system" },
      systemAdmin,
    );

    const bare = createConfigResolver();
    const keyDef = stack.registry.getConfigKey(API_KEY);
    expect(keyDef).toBeDefined();

    await expect(
      bare.getCascade(API_KEY, keyDef!, systemAdmin.tenantId, systemAdmin.id, stack.db),
    ).rejects.toThrow(/backing="secrets".*without a secrets/);
  });
});

describe("config backing=secrets — reset dispatch", () => {
  test("reset clears the secret; the key falls back to unset", async () => {
    await stack.http.writeOk(ConfigHandlers.reset, { key: API_KEY, scope: "system" }, systemAdmin);

    const secretRows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: SYSTEM_TENANT,
      key: API_KEY,
    });
    expect(secretRows).toHaveLength(0);

    const res = await stack.http.queryOk<{ value: unknown }>(
      "billing:query:peek-api-key",
      {},
      systemAdmin,
    );
    // No keyDef.default on apiKey → genuinely unset after the secret is gone.
    expect(res.value).toBeUndefined();
  });
});
