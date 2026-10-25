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
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { billingFeature, stripeApiKeyHandle } from "../feature";

// Each test gets its own pair of tenants, so config rows from other tests never show up.
let acmeAdmin = { ...TestUsers.admin, tenantId: testTenantId(1) };
let globexAdmin = { ...TestUsers.admin, tenantId: testTenantId(2), id: "globex-admin" };
let nextTenantPair = 0;

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [createConfigFeature(), billingFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => stack?.cleanup());

beforeEach(() => {
  nextTenantPair += 1;
  acmeAdmin = { ...TestUsers.admin, tenantId: testTenantId(nextTenantPair * 2 + 1) };
  globexAdmin = {
    ...TestUsers.admin,
    tenantId: testTenantId(nextTenantPair * 2 + 2),
    id: "globex-admin",
  };
});

describe("encrypted tenant-config: per-tenant Stripe-API-key", () => {
  test("DB stores ciphertext, NOT plaintext", async () => {
    const plaintextKey = "sk_live_super_secret_stripe_key_12345";
    await stack.http.writeOk(
      "config:write:set",
      { key: stripeApiKeyHandle.name, value: plaintextKey, scope: "tenant" },
      acmeAdmin,
    );

    const rows = await selectMany(stack.db, configValuesTable, {
      key: stripeApiKeyHandle.name,
      tenantId: acmeAdmin.tenantId,
    });
    expect(rows.length).toBe(1);
    const stored = rows[0]?.["value"];
    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("sk_live");
    expect(stored).not.toContain("12345");
    expect(stored).not.toContain("super_secret");
  });

  test("config:query:values masks encrypted key with ••••••", async () => {
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

  test("charge-handler reads the decrypted key + uses it", async () => {
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
