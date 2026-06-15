// End-to-end over real HTTP: one declarative config surface, two backings.
//
//   payment-api-key (backing:"secrets") → set routes into the secrets envelope,
//   masked in queries, revealed only for the owning feature's ctx.config read.
//
//   smtp-host (config, tenant scope) → platform default → system-row → tenant
//   override; cascade proves a tenant override does not leak across tenants.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSecretsContext,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { ConfigCascade } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { integrationsFeature, paymentApiKeyHandle, smtpHostHandle } from "../feature";

const SYSTEM_TENANT = "00000000-0000-4000-8000-000000000000";
const TENANT_A = testTenantId(1);
const TENANT_B = testTenantId(2);

const systemAdmin = TestUsers.systemAdmin;
const acmeAdmin = { ...TestUsers.admin, tenantId: TENANT_A, id: "acme-admin" };
const globexAdmin = { ...TestUsers.admin, tenantId: TENANT_B, id: "globex-admin" };

type Cascades = Record<string, ConfigCascade>;

let stack: TestStack;

beforeAll(async () => {
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createConfigFeature(), integrationsFeature],
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

afterAll(async () => stack?.cleanup());

describe("managed config — backing:secrets system key", () => {
  test("set routes the value into the secrets store, not config_values", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: paymentApiKeyHandle.name, value: "sk-live-acme-99", scope: "system" },
      systemAdmin,
    );

    const secretRows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: SYSTEM_TENANT,
      key: paymentApiKeyHandle.name,
    });
    expect(secretRows).toHaveLength(1);
    // The plaintext never touches config_values, and the stored secret is an
    // envelope — no column carries the cleartext.
    const configRows = await selectMany(stack.db, configValuesTable, {
      key: paymentApiKeyHandle.name,
    });
    expect(configRows).toHaveLength(0);
    expect(JSON.stringify(secretRows[0])).not.toContain("sk-live-acme-99");
  });

  test("the owning feature reads the revealed plaintext via ctx.config", async () => {
    const res = await stack.http.queryOk<{ value: unknown }>(
      "integrations:query:peek-payment-key",
      {},
      systemAdmin,
    );
    expect(res.value).toBe("sk-live-acme-99");
  });

  test("config:query:cascade masks the value and every level", async () => {
    const res = await stack.http.queryOk<Cascades>(
      "config:query:cascade",
      { keys: [paymentApiKeyHandle.name] },
      systemAdmin,
    );
    const cascade = res[paymentApiKeyHandle.name];
    expect(cascade?.value).toBe("••••••");
    expect(cascade?.source).toBe("system-row");
    expect(JSON.stringify(cascade)).not.toContain("sk-live-acme-99");
  });
});

describe("managed config — tenant cascade override", () => {
  test("with no rows the tenant sees the platform default", async () => {
    const res = await stack.http.queryOk<Cascades>(
      "config:query:cascade",
      { keys: [smtpHostHandle.name] },
      globexAdmin,
    );
    const cascade = res[smtpHostHandle.name];
    expect(cascade?.value).toBe("smtp.platform.example");
    expect(cascade?.source).toBe("default");
  });

  test("a system-row default cascades to every tenant", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: smtpHostHandle.name, value: "smtp.system.example", scope: "system" },
      systemAdmin,
    );
    const res = await stack.http.queryOk<Cascades>(
      "config:query:cascade",
      { keys: [smtpHostHandle.name] },
      globexAdmin,
    );
    const cascade = res[smtpHostHandle.name];
    expect(cascade?.value).toBe("smtp.system.example");
    expect(cascade?.source).toBe("system-row");
  });

  test("a tenant override wins for its tenant and never leaks to another", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: smtpHostHandle.name, value: "smtp.acme.example", scope: "tenant" },
      acmeAdmin,
    );

    const acme = (
      await stack.http.queryOk<Cascades>(
        "config:query:cascade",
        { keys: [smtpHostHandle.name] },
        acmeAdmin,
      )
    )[smtpHostHandle.name];
    expect(acme?.value).toBe("smtp.acme.example");
    expect(acme?.source).toBe("tenant-row");

    // Tenant B never set an override → still resolves the system-row default.
    const globex = (
      await stack.http.queryOk<Cascades>(
        "config:query:cascade",
        { keys: [smtpHostHandle.name] },
        globexAdmin,
      )
    )[smtpHostHandle.name];
    expect(globex?.value).toBe("smtp.system.example");
    expect(globex?.source).toBe("system-row");
  });
});
