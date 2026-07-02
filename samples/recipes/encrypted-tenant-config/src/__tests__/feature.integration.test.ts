// End-to-End: Tenant-Admin setzt Stripe-API-Key → DB hat ciphertext →
// charge-handler liest entschlüsselt → caller sieht charge-id, NIE den
// Key. Plus: zwei Tenants haben getrennte Keys.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { buildConfigFeatureSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { billingFeature, stripeApiKeyHandle } from "../feature";

const TENANT_A = testTenantId(1);
const TENANT_B = testTenantId(2);
const acmeAdmin = { ...TestUsers.admin, tenantId: TENANT_A };
const globexAdmin = { ...TestUsers.admin, tenantId: TENANT_B, id: "globex-admin" };

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [createConfigFeature(), billingFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => stack?.cleanup());

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${configValuesTable.tableName}"`);
});

describe("encrypted tenant-config: per-tenant Stripe-API-key", () => {
  test("DB hält ciphertext, NICHT plaintext", async () => {
    const plaintextKey = "sk_live_super_secret_stripe_key_12345";
    await stack.http.writeOk(
      "config:write:set",
      { key: stripeApiKeyHandle.name, value: plaintextKey, scope: "tenant" },
      acmeAdmin,
    );

    const rows = await selectMany(stack.db, configValuesTable, { key: stripeApiKeyHandle.name });
    expect(rows.length).toBe(1);
    const stored = rows[0]?.["value"];
    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("sk_live");
    expect(stored).not.toContain("12345");
    expect(stored).not.toContain("super_secret");
  });

  test("config:query:values maskt encrypted-key mit ••••••", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: stripeApiKeyHandle.name, value: "sk_live_xyz", scope: "tenant" },
      acmeAdmin,
    );
    const cfg = await stack.http.queryOk<Record<string, { value: unknown; scope: string }>>(
      "config:query:values",
      {},
      acmeAdmin,
    );
    expect(cfg[stripeApiKeyHandle.name]?.value).toBe("••••••");
  });

  test("charge-handler liest den entschlüsselten Key + nutzt ihn", async () => {
    // Charge ohne gesetzten Key → schlägt mit klarer Error fehl
    const noKey = await stack.http.write(
      "billing:write:charge",
      { amount: 1000, customerRef: "cust_42" },
      acmeAdmin,
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);

    // Key setzen → charge geht durch (mock-impl returnt charge-id)
    await stack.http.writeOk(
      "config:write:set",
      { key: stripeApiKeyHandle.name, value: "sk_live_acme", scope: "tenant" },
      acmeAdmin,
    );
    const ok = await stack.http.writeOk<{ chargeId: string }>(
      "billing:write:charge",
      { amount: 1000, customerRef: "cust_42" },
      acmeAdmin,
    );
    expect(ok.chargeId).toContain("cust_42");
  });

  test("Tenant-Isolation: Tenant-A's Key leakt NICHT zu Tenant-B", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: stripeApiKeyHandle.name, value: "sk_live_acme_only", scope: "tenant" },
      acmeAdmin,
    );

    // Tenant-B macht charge OHNE eigenen Key → fehlschlägt (sieht
    // den acme-Key NICHT). Beweis: per-tenant config-row, nicht globale
    // Variable.
    const res = await stack.http.write(
      "billing:write:charge",
      { amount: 500, customerRef: "globex_cust" },
      globexAdmin,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// The recipe's headline claim: the `mask` entry alone (no hand-written
// r.screen/r.nav) makes buildConfigFeatureSchema derive the configEdit screen
// for the key. If that derivation broke for this key name (e.g. after a
// framework refactor), the recipe would silently stop showing the field — pin it.
describe("encrypted tenant-config: mask derives the configEdit screen", () => {
  test("buildConfigFeatureSchema produces billing-tenant with the qualified stripe key", () => {
    const schema = buildConfigFeatureSchema(
      createRegistry([createConfigFeature(), billingFeature]),
    );
    const screen = schema.screens.find((s) => s.id === "billing-tenant");
    expect(screen).toBeDefined();
    expect(screen?.type).toBe("configEdit");
    if (screen?.type === "configEdit") {
      expect(screen.configKeys).toEqual({ "stripe-api-key": stripeApiKeyHandle.name });
      // mask.title flows through to the per-field label override.
      expect(screen.fieldLabels).toEqual({ "stripe-api-key": "billing.stripe-api-key" });
    }
  });
});
