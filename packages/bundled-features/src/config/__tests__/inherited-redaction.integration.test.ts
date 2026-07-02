import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  type ConfigCascade,
  createSystemConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { type ConfigResolver, createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

// Proves the inheritedToTenant:false redaction end-to-end over real HTTP: a
// tenant-side admin who is allowed to READ the key (access.admin) must never
// receive the inherited system value through either config read handler, while
// the SystemAdmin who owns the platform default still sees it.

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;

const systemAdmin = TestUsers.systemAdmin; // roles ["SystemAdmin"]
const tenantAdmin = createTestUser({ id: 2 }); // roles ["Admin"], same tenant

const SMTP_HOST = "platform:config:smtp-host";
const SMTP_PASS = "platform:config:smtp-pass";
const LIST_HITS = "platform:config:list-hits";
const LIST_CAP = "platform:config:list-cap";

const configFeature = createConfigFeature();

const platformFeature = defineFeature("platform", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      // Hidden, plaintext: a tenant may read the key but not its system value.
      smtpHost: createSystemConfig("text", {
        inheritedToTenant: false,
        write: access.systemAdmin,
        read: access.admin,
      }),
      // Hidden + encrypted: composition — neither value nor "is set" may leak.
      smtpPass: createSystemConfig("text", {
        inheritedToTenant: false,
        encrypted: true,
        write: access.systemAdmin,
        read: access.admin,
      }),
      // Control: default inheritance — a tenant sees the platform value.
      listHits: createSystemConfig("number", {
        default: 10,
        write: access.systemAdmin,
        read: access.admin,
      }),
      // Control: default inheritance WITH a set system-row value — proves a
      // tenant receives the inherited system-row value (not just the
      // keyDef.default fallback). The default (5) differs from the seeded
      // system-row (42) so a broken pass-through can't masquerade as the
      // default.
      listCap: createSystemConfig("number", {
        default: 5,
        write: access.systemAdmin,
        read: access.admin,
      }),
    },
  });
});

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [configFeature, platformFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;
  await unsafePushTables(db, { configValuesTable });

  // Seed the platform (system-row) values via the real write path.
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: SMTP_HOST, value: "smtp.internal.example.com", scope: "system" },
    systemAdmin,
  );
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: SMTP_PASS, value: "s3cr3t-password", scope: "system" },
    systemAdmin,
  );
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: LIST_CAP, value: 42, scope: "system" },
    systemAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

type Cascades = Record<string, ConfigCascade>;
const systemLevel = (c: Cascades, key: string) =>
  c[key]?.levels.find((l) => l.source === "system-row");

describe("inheritedToTenant redaction — config:query:cascade", () => {
  test("SystemAdmin sees the inherited system value", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [SMTP_HOST] },
      systemAdmin,
    );
    expect(systemLevel(res, SMTP_HOST)?.value).toBe("smtp.internal.example.com");
    expect(res[SMTP_HOST]?.value).toBe("smtp.internal.example.com");
  });

  test("tenant-side admin gets the system value redacted (value AND hasValue)", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [SMTP_HOST] },
      tenantAdmin,
    );
    const sys = systemLevel(res, SMTP_HOST);
    expect(sys?.value).toBeUndefined();
    expect(sys?.hasValue).toBe(false);
    expect(res[SMTP_HOST]?.value).not.toBe("smtp.internal.example.com");
  });

  test("composition: encrypted + inheritedToTenant:false leaks neither value nor 'is set'", async () => {
    const tenant = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [SMTP_PASS] },
      tenantAdmin,
    );
    const tenantSys = systemLevel(tenant, SMTP_PASS);
    expect(tenantSys?.value).toBeUndefined(); // not even the "••••••" mask
    expect(tenantSys?.hasValue).toBe(false);

    // SystemAdmin still sees it as set, value hidden by encryption masking.
    const sa = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [SMTP_PASS] },
      systemAdmin,
    );
    const saSys = systemLevel(sa, SMTP_PASS);
    expect(saSys?.value).toBe("••••••");
    expect(saSys?.hasValue).toBe(true);
  });

  test("control: a transparently-inherited system key stays visible to tenants", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [LIST_HITS] },
      tenantAdmin,
    );
    expect(res[LIST_HITS]?.value).toBe(10);
  });

  test("control: a SET system-row value is inherited by tenants (not the default)", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [LIST_CAP] },
      tenantAdmin,
    );
    // 42 = seeded system-row value; would be 5 (keyDef.default) if pass-through
    // for non-redacted keys were broken.
    expect(res[LIST_CAP]?.value).toBe(42);
    expect(systemLevel(res, LIST_CAP)?.value).toBe(42);
    expect(systemLevel(res, LIST_CAP)?.hasValue).toBe(true);
  });
});

describe("inheritedToTenant redaction — config:query:values", () => {
  test("SystemAdmin sees the inherited system value", async () => {
    const res = await stack.http.queryOk<Record<string, { value: unknown; source: string }>>(
      ConfigQueries.values,
      {},
      systemAdmin,
    );
    expect(res[SMTP_HOST]?.value).toBe("smtp.internal.example.com");
  });

  test("tenant-side admin sees the key as unset, not the inherited value", async () => {
    const res = await stack.http.queryOk<Record<string, { value: unknown; source: string }>>(
      ConfigQueries.values,
      {},
      tenantAdmin,
    );
    expect(res[SMTP_HOST]?.value).not.toBe("smtp.internal.example.com");
    // No keyDef.default on SMTP_HOST → after redaction the key is genuinely
    // unset. values.query now resolves through the cascade (same path as
    // config:query:cascade), so the source is "missing", matching cascade.query
    // instead of the old values.query-only synthesized "default".
    expect(res[SMTP_HOST]?.source).toBe("missing");
  });
});
