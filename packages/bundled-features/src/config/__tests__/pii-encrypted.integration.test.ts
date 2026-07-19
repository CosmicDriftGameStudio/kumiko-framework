// piiEncrypted config keys (kumiko-platform#231/#459): the value is
// subject-KMS-encrypted at rest (tenant-row → tenant subject, user-row →
// user subject), decrypted on read for authorized readers — unlike
// `encrypted`/`backing="secrets"`, which the `values` query always masks
// regardless of role (see config/handlers/values.query.ts).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  access,
  createTenantConfig,
  createUserConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

const BILLING_ADDRESS_KEY = "pii-cfg-test:config:billing-address";
const PHONE_NUMBER_KEY = "pii-cfg-test:config:phone-number";

const piiFeature = defineFeature("pii-cfg-test", (r) => {
  r.requires("config");

  r.config({
    keys: {
      billingAddress: createTenantConfig("text", {
        piiEncrypted: true,
        read: access.all,
        write: access.all,
      }),
      phoneNumber: createUserConfig("text", {
        piiEncrypted: true,
        read: access.all,
        write: access.all,
      }),
    },
  });
});

const configFeature = createConfigFeature();

let stack: TestStack;
const kms = new InMemoryKmsAdapter();
const tenantAdmin = createTestUser({ id: 2 });

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [configFeature, piiFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
  // One shared KMS instance for the whole file, not beforeEach/afterEach:
  // config rows persist in the same DB across tests in this file, so a
  // fresh adapter per test would orphan the previous test's ciphertext
  // (KeyNotFoundError) the moment the values query resolves more than the
  // one key that test just wrote.
  configurePiiSubjectKms(kms);
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

describe("piiEncrypted config keys", () => {
  test("tenant-scope value is stored as tenant-subject ciphertext, read back as plaintext", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: BILLING_ADDRESS_KEY, value: "Musterstrasse 1, 12345 Berlin" },
      tenantAdmin,
    );

    const row = await fetchOne<{ value: string }>(stack.db, configValuesTable, {
      key: BILLING_ADDRESS_KEY,
      tenantId: tenantAdmin.tenantId,
    });
    expect(row).toBeDefined();
    expect(isPiiCiphertext(row?.value)).toBe(true);
    expect(row?.value).toStartWith(`kumiko-pii:v1:tenant:${tenantAdmin.tenantId}:`);

    const values = await stack.http.queryOk<
      Record<string, { value: unknown; scope: string; source: string }>
    >(ConfigQueries.values, {}, tenantAdmin);
    expect(values[BILLING_ADDRESS_KEY]?.value).toBe("Musterstrasse 1, 12345 Berlin");
  });

  test("user-scope value is stored as user-subject ciphertext, distinct from tenant subject", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: PHONE_NUMBER_KEY, value: "+49 151 00000000" },
      tenantAdmin,
    );

    const row = await fetchOne<{ value: string }>(stack.db, configValuesTable, {
      key: PHONE_NUMBER_KEY,
      tenantId: tenantAdmin.tenantId,
      userId: String(tenantAdmin.id),
    });
    expect(row).toBeDefined();
    expect(isPiiCiphertext(row?.value)).toBe(true);
    expect(row?.value).toStartWith(`kumiko-pii:v1:user:${tenantAdmin.id}:`);

    const values = await stack.http.queryOk<
      Record<string, { value: unknown; scope: string; source: string }>
    >(ConfigQueries.values, {}, tenantAdmin);
    expect(values[PHONE_NUMBER_KEY]?.value).toBe("+49 151 00000000");
  });

  test("write with scope override to system is rejected — no subject for system-row", async () => {
    // SystemAdmin so checkScopeWriteAccess passes and the request actually
    // reaches the piiEncrypted+scope="system" rejection, not an earlier
    // generic "you can't write system scope" denial.
    const err = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: BILLING_ADDRESS_KEY, value: "irrelevant", scope: "system" },
      TestUsers.systemAdmin,
    );
    expect(err.code).toBe("unprocessable");
    expect((err.details as { reason?: string } | undefined)?.reason).toBe("invalid_scope");
  });

  test("write without a configured KMS fails loud instead of silently storing plaintext", async () => {
    resetPiiSubjectKmsForTests();
    expect(configuredPiiSubjectKms()).toBeUndefined();

    try {
      const res = await stack.http.write(
        ConfigHandlers.set,
        { key: BILLING_ADDRESS_KEY, value: "no-kms-value" },
        tenantAdmin,
      );
      expect(res.status).toBe(500);
    } finally {
      // Restore for any test running after this one in the file.
      configurePiiSubjectKms(kms);
    }
  });
});
