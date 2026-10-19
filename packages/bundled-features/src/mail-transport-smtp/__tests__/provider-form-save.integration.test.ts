// The generated provider form saves the provider, the SMTP settings and the SMTP
// password in one /api/batch call. The server must take that mix of config and
// secrets commands as one unit: all stored, or nothing.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  buildConfigFeatureSchema,
  type ConfigEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createMailFoundationFeature } from "../../mail-foundation/feature.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createMailTransportSmtpFeature } from "../feature.ts";

const PROVIDER_FIELD = "provider";
const HOST_FIELD = "mail-transport-smtp-host";
const PASSWORD_FIELD = "mail-transport-smtp-smtp-password";

type StoredConfig = Record<string, { readonly value: unknown } | undefined>;
type StoredSecret = { readonly key: string };

let stack: TestStack;
let form: ConfigEditScreenDefinition;

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

function configKeyOf(field: string): string {
  const key = form.configKeys[field];
  if (key === undefined) throw new Error(`form has no config field "${field}"`);
  return key;
}

function secretKeyOf(field: string): string {
  const key = form.secretKeys?.[field];
  if (key === undefined) throw new Error(`form has no secret field "${field}"`);
  return key;
}

beforeAll(async () => {
  const resolver = createConfigResolver({
    cipher: createTestEnvelopeCipher(randomBytes(32).toString("base64")),
  });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createMailFoundationFeature(),
      createMailTransportSmtpFeature(),
    ],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenant_secrets: tenantSecretsTable });

  const generated = buildConfigFeatureSchema(stack.registry).screens.find(
    (screen) => screen.id === "mail-foundation-tenant",
  );
  if (generated?.type !== "configEdit") throw new Error("provider form missing");
  form = generated;
});

afterAll(async () => {
  await stack.cleanup();
});

describe("mail provider form :: one save over /api/batch", () => {
  test("provider, server address and password are stored by one batch", async () => {
    const admin = adminFor(811);
    const res = await stack.http.batch(
      [
        {
          type: "config:write:set",
          payload: { key: configKeyOf(PROVIDER_FIELD), value: "smtp", scope: "tenant" },
        },
        {
          type: "config:write:set",
          payload: { key: configKeyOf(HOST_FIELD), value: "smtp.example.test", scope: "tenant" },
        },
        {
          type: "secrets:write:set",
          payload: { key: secretKeyOf(PASSWORD_FIELD), value: "provider-form-test-password" },
        },
      ],
      admin,
    );
    expect(res.status).toBe(200);

    const values = await stack.http.queryOk<StoredConfig>("config:query:values", {}, admin);
    expect(values[configKeyOf(PROVIDER_FIELD)]?.value).toBe("smtp");
    expect(values[configKeyOf(HOST_FIELD)]?.value).toBe("smtp.example.test");
    const secrets = await stack.http.queryOk<StoredSecret[]>("secrets:query:list", {}, admin);
    expect(secrets.map((row) => row.key)).toContain(secretKeyOf(PASSWORD_FIELD));
  });

  test("a rejected provider stores neither the password nor the server address", async () => {
    const admin = adminFor(812);
    const res = await stack.http.batch(
      [
        {
          type: "secrets:write:set",
          payload: { key: secretKeyOf(PASSWORD_FIELD), value: "provider-form-test-password" },
        },
        {
          type: "config:write:set",
          payload: { key: configKeyOf(HOST_FIELD), value: "smtp.example.test", scope: "tenant" },
        },
        {
          type: "config:write:set",
          payload: { key: configKeyOf(PROVIDER_FIELD), value: "not-a-provider", scope: "tenant" },
        },
      ],
      admin,
    );
    expect(res.status).not.toBe(200);

    const values = await stack.http.queryOk<StoredConfig>("config:query:values", {}, admin);
    expect(values[configKeyOf(HOST_FIELD)]?.value).not.toBe("smtp.example.test");
    const secrets = await stack.http.queryOk<StoredSecret[]>("secrets:query:list", {}, admin);
    expect(secrets.map((row) => row.key)).not.toContain(secretKeyOf(PASSWORD_FIELD));
  });

  test("choosing the platform default stores an empty provider", async () => {
    const admin = adminFor(813);
    const setProvider = (value: string) =>
      stack.http.batch(
        [
          {
            type: "config:write:set",
            payload: { key: configKeyOf(PROVIDER_FIELD), value, scope: "tenant" },
          },
        ],
        admin,
      );
    expect((await setProvider("smtp")).status).toBe(200);
    expect((await setProvider("")).status).toBe(200);

    const values = await stack.http.queryOk<StoredConfig>("config:query:values", {}, admin);
    expect(values[configKeyOf(PROVIDER_FIELD)]?.value).toBe("");
  });
});
