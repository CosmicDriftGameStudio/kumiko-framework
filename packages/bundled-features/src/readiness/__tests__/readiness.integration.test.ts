// Full-stack integration test for the readiness rollup. Drives
// readiness:query:status through the dispatcher so the real config-cascade
// + secrets-metadata-lookup are exercised — including the no-read-audit
// guarantee of the has() probe.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { createConfigAccessorFactory } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import {
  createSecretsContext,
  createSecretsFeature,
  TENANT_SECRET_READ_EVENT,
  tenantSecretsTable,
} from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { ReadinessQueries } from "../constants";
import { readinessFeature } from "../feature";

// Probe-feature: one required + one optional config key, one required +
// one optional secret — the rollup must list exactly the required gaps.
const probeFeature = defineFeature("readiness-probe", (r) => {
  r.requires("config");
  r.requires("secrets");

  r.config({
    keys: {
      apiUrl: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      timeout: createTenantConfig("number", {
        default: 30,
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // Operator-Key: required, aber read/write über dem TenantAdmin —
      // der Verdict muss ihn TROTZDEM zählen (277/1: der Per-Key-read-
      // Filter droppte ihn still und log ready:true).
      operatorEndpoint: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("SystemAdmin"),
        read: access.roles("SystemAdmin"),
      }),
    },
  });

  r.secret("probe.apiToken", {
    label: { de: "API-Token", en: "API token" },
    scope: "tenant",
    required: true,
  });
  r.secret("probe.optionalToken", {
    label: { de: "Optionales Token", en: "Optional token" },
    scope: "tenant",
  });
});

// Provider-gating fixture: foundation declares the selector, two providers
// register under the point. The smtp-ish one carries required key + secret —
// they must count ONLY while "smtp" is the selected provider.
const probeMailFoundation = defineFeature("probe-mail-foundation", (r) => {
  r.requires("config");
  r.extendsRegistrar("probeMailTransport", { onRegister: () => undefined });
  const configKeys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });
  r.extensionSelector("probeMailTransport", configKeys.provider);
  return { configKeys };
});

const probeSmtpProvider = defineFeature("probe-smtp", (r) => {
  r.requires("config");
  r.requires("secrets");
  r.useExtension("probeMailTransport", "smtp");
  r.config({
    keys: {
      host: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });
  r.secret("smtp.password", {
    label: { de: "SMTP-Passwort", en: "SMTP password" },
    scope: "tenant",
    required: true,
  });
});

const probeInMemoryProvider = defineFeature("probe-inmemory", (r) => {
  r.useExtension("probeMailTransport", "inmemory");
});

const REQUIRED_CONFIG_KEY = "readiness-probe:config:api-url";
const REQUIRED_SECRET_KEY = "readiness-probe:secret:probe-api-token";
const PROVIDER_SELECTOR_KEY = "probe-mail-foundation:config:provider";
const GATED_CONFIG_KEY = "probe-smtp:config:host";
const GATED_SECRET_KEY = "probe-smtp:secret:smtp-password";

type StatusResult = {
  missingConfig: ReadonlyArray<{ key: string; scope: string; type: string }>;
  missingSecrets: ReadonlyArray<{ key: string }>;
  ready: boolean;
};

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  const encryption = createEncryptionProvider(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ encryption });
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
      readinessFeature,
      probeFeature,
      probeMailFoundation,
      probeSmtpProvider,
      probeInMemoryProvider,
    ],
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider }),
    }),
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

// Der 277/1-Probe-Key ist SystemAdmin-gated — Tests, die ready:true
// erwarten, setzen ihn über diesen Helper (gleicher Tenant, Operator-Rolle).
async function setOperatorEndpoint(admin: ReturnType<typeof adminFor>): Promise<void> {
  await stack.http.writeOk(
    "config:write:set",
    { key: "readiness-probe:config:operator-endpoint", value: "https://op.example.test" },
    { ...admin, roles: ["SystemAdmin"] },
  );
}

async function statusFor(admin: ReturnType<typeof adminFor>): Promise<StatusResult> {
  return stack.http.queryOk<StatusResult>(ReadinessQueries.status, {}, admin);
}

describe("readiness:query:status", () => {
  test("fresh tenant → required config + secret listed as missing, ready false", async () => {
    const admin = adminFor(601);

    const status = await statusFor(admin);

    expect(status.ready).toBe(false);
    expect(status.missingConfig).toContainEqual({
      key: REQUIRED_CONFIG_KEY,
      scope: "tenant",
      type: "text",
    });
    expect(status.missingSecrets).toContainEqual({ key: REQUIRED_SECRET_KEY });
    // Optional keys must not appear — they have usable defaults / aren't required.
    expect(status.missingConfig.map((k) => k.key)).not.toContain("readiness-probe:config:timeout");
    expect(status.missingSecrets.map((s) => s.key)).not.toContain(
      "readiness-probe:secret:probe-optional-token",
    );
  });

  test("setting required config + secret flips ready to true", async () => {
    const admin = adminFor(602);

    await stack.http.writeOk(
      "config:write:set",
      { key: REQUIRED_CONFIG_KEY, value: "https://api.example.test" },
      admin,
    );
    await stack.http.writeOk(
      "secrets:write:set",
      { key: REQUIRED_SECRET_KEY, value: "token-xyz" },
      admin,
    );
    await setOperatorEndpoint(admin);

    const status = await statusFor(admin);
    expect(status.missingConfig.map((k) => k.key)).not.toContain(REQUIRED_CONFIG_KEY);
    expect(status.missingSecrets).toEqual([]);
    expect(status.ready).toBe(true);
  });

  test("SystemAdmin-gated required Key zählt im Verdict des TenantAdmin (277/1)", async () => {
    const admin = adminFor(605);

    const status = await statusFor(admin);

    // Der Caller darf den Key nicht LESEN — fürs Verdict muss er trotzdem
    // als missing erscheinen, sonst lügt ready:true.
    expect(status.missingConfig.map((k) => k.key)).toContain(
      "readiness-probe:config:operator-endpoint",
    );
    expect(status.ready).toBe(false);
  });

  test("tenant isolation: tenant A's values don't make tenant B ready", async () => {
    const adminA = adminFor(603);
    const adminB = adminFor(604);

    await stack.http.writeOk(
      "config:write:set",
      { key: REQUIRED_CONFIG_KEY, value: "https://a.example.test" },
      adminA,
    );
    await stack.http.writeOk(
      "secrets:write:set",
      { key: REQUIRED_SECRET_KEY, value: "token-a" },
      adminA,
    );
    await setOperatorEndpoint(adminA);

    expect((await statusFor(adminA)).ready).toBe(true);
    const statusB = await statusFor(adminB);
    expect(statusB.ready).toBe(false);
    expect(statusB.missingSecrets).toContainEqual({ key: REQUIRED_SECRET_KEY });
  });

  test("non-TenantAdmin → access denied (same gate as secrets:query:list)", async () => {
    const member = createTestUser({
      id: 605,
      tenantId: testTenantId(605),
      roles: ["Member"],
    });

    const res = await stack.http.query(ReadinessQueries.status, {}, member);
    expect(res.status).toBe(403);
  });

  test("provider-gated keys don't count while no provider is selected", async () => {
    const admin = adminFor(607);

    const status = await statusFor(admin);
    expect(status.missingConfig.map((k) => k.key)).not.toContain(GATED_CONFIG_KEY);
    expect(status.missingSecrets.map((s) => s.key)).not.toContain(GATED_SECRET_KEY);
  });

  test("selecting the provider pulls its required key + secret into missing", async () => {
    const admin = adminFor(608);

    await stack.http.writeOk(
      "config:write:set",
      { key: PROVIDER_SELECTOR_KEY, value: "smtp" },
      admin,
    );

    const status = await statusFor(admin);
    expect(status.missingConfig.map((k) => k.key)).toContain(GATED_CONFIG_KEY);
    expect(status.missingSecrets).toContainEqual({ key: GATED_SECRET_KEY });
    expect(status.ready).toBe(false);
  });

  test("tenant on the inmemory provider is ready despite unset smtp keys", async () => {
    const admin = adminFor(609);

    // The advisor scenario: smtp + inmemory both mounted, tenant runs
    // inmemory — unset smtp keys must not block ready.
    await stack.http.writeOk(
      "config:write:set",
      { key: PROVIDER_SELECTOR_KEY, value: "inmemory" },
      admin,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: REQUIRED_CONFIG_KEY, value: "https://api.example.test" },
      admin,
    );
    await stack.http.writeOk(
      "secrets:write:set",
      { key: REQUIRED_SECRET_KEY, value: "token-609" },
      admin,
    );
    await setOperatorEndpoint(admin);

    const status = await statusFor(admin);
    expect(status.missingConfig).toEqual([]);
    expect(status.missingSecrets).toEqual([]);
    expect(status.ready).toBe(true);
  });

  test("config:query:readiness applies the same provider gating", async () => {
    const admin = adminFor(610);

    const before = await stack.http.queryOk<{ missing: ReadonlyArray<{ key: string }> }>(
      "config:query:readiness",
      {},
      admin,
    );
    expect(before.missing.map((k) => k.key)).not.toContain(GATED_CONFIG_KEY);

    await stack.http.writeOk(
      "config:write:set",
      { key: PROVIDER_SELECTOR_KEY, value: "smtp" },
      admin,
    );
    const after = await stack.http.queryOk<{ missing: ReadonlyArray<{ key: string }> }>(
      "config:query:readiness",
      {},
      admin,
    );
    expect(after.missing.map((k) => k.key)).toContain(GATED_CONFIG_KEY);
  });

  test("status probe writes NO secret-read audit events", async () => {
    const admin = adminFor(606);
    await stack.http.writeOk(
      "secrets:write:set",
      { key: REQUIRED_SECRET_KEY, value: "token-606" },
      admin,
    );
    await asRawClient(db).unsafe(
      `DELETE FROM "${eventsTable.tableName}" WHERE type = '${TENANT_SECRET_READ_EVENT}'`,
    );

    // Probes both branches: set secret (has → true) + missing optional.
    await statusFor(admin);

    const readEvents = await selectMany(db, eventsTable, { type: TENANT_SECRET_READ_EVENT });
    expect(readEvents).toEqual([]);
  });
});
