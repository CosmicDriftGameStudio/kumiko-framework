import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  access,
  createTenantConfig,
  defineFeature,
  selectablePluginIds,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

const SELECTOR_KEY = "probe-transport:config:provider";
const OPEN_SELECTOR_KEY = "probe-open-transport:config:provider";

const transportFoundation = defineFeature("probe-transport", (r) => {
  r.requires("config");
  r.extendsRegistrar("probeTransport", { onRegister: () => undefined });
  const keys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin"),
        read: access.roles("TenantAdmin"),
      }),
    },
  });
  r.extensionSelector("probeTransport", keys.provider);
});

const openFoundation = defineFeature("probe-open-transport", (r) => {
  r.requires("config");
  r.extendsRegistrar("probeOpenTransport", { onRegister: () => undefined });
  const keys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin"),
        read: access.all,
      }),
    },
  });
  r.extensionSelector("probeOpenTransport", keys.provider);
});

const platformFoundation = defineFeature("probe-platform-transport", (r) => {
  r.requires("config");
  r.extendsRegistrar("probePlatformTransport", { onRegister: () => undefined });
  const keys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        inheritedToTenant: false,
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });
  r.extensionSelector("probePlatformTransport", keys.provider);
});

const platformPlugin = defineFeature("probe-platform-plugin", (r) => {
  r.useExtension("probePlatformTransport", "platform-smtp");
});

const pluginX = defineFeature("probe-plugin-x", (r) => {
  r.useExtension("probeTransport", "x");
});
const pluginY = defineFeature("probe-plugin-y", (r) => {
  r.useExtension("probeTransport", "y");
});
const openPlugin = defineFeature("probe-open-plugin", (r) => {
  r.useExtension("probeOpenTransport", "open");
});

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver({
    cipher: createTestEnvelopeCipher(randomBytes(32).toString("base64")),
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      transportFoundation,
      openFoundation,
      platformFoundation,
      platformPlugin,
      pluginX,
      pluginY,
      openPlugin,
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

function tenantAdmin(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

function plainUser(tenantNumber: number) {
  return createTestUser({
    id: 100 + tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["User"],
  });
}

describe("config:write:set — extension selector validation", () => {
  test("registry lists the mounted plugin ids the write is validated against", () => {
    expect(selectablePluginIds(stack.registry, "probeTransport")).toEqual(["x", "y"]);
  });

  test("unknown plugin id is rejected with 422 and its i18n key", async () => {
    const err = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: SELECTOR_KEY, value: "nope" },
      tenantAdmin(701),
    );
    expect(err).toMatchObject({
      httpStatus: 422,
      code: "unprocessable",
      i18nKey: "config.errors.unknownExtensionPlugin",
    });
  });

  test("mounted plugin id and the empty string are accepted", async () => {
    const admin = tenantAdmin(702);
    await stack.http.writeOk(ConfigHandlers.set, { key: SELECTOR_KEY, value: "x" }, admin);
    await stack.http.writeOk(ConfigHandlers.set, { key: SELECTOR_KEY, value: "" }, admin);
  });
});

describe("config:query:config-value:selected-extensions", () => {
  test("returns the caller's own tenant selection, never another tenant's", async () => {
    const adminA = tenantAdmin(711);
    const adminB = tenantAdmin(712);
    await stack.http.writeOk(ConfigHandlers.set, { key: SELECTOR_KEY, value: "x" }, adminA);

    const seenByA = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      adminA,
    );
    const seenByB = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      adminB,
    );
    expect(seenByA).toEqual({ probeTransport: "x" });
    expect(seenByB).toEqual({});

    await stack.http.writeOk(ConfigHandlers.set, { key: SELECTOR_KEY, value: "y" }, adminB);
    const afterB = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      adminB,
    );
    expect(afterB).toEqual({ probeTransport: "y" });
    expect(
      await stack.http.queryOk<Record<string, string>>(
        ConfigQueries.selectedExtensions,
        {},
        adminA,
      ),
    ).toEqual({
      probeTransport: "x",
    });
  });

  test("omits selectors the caller may not read", async () => {
    const admin = tenantAdmin(713);
    await stack.http.writeOk(ConfigHandlers.set, { key: SELECTOR_KEY, value: "x" }, admin);
    await stack.http.writeOk(ConfigHandlers.set, { key: OPEN_SELECTOR_KEY, value: "open" }, admin);

    const seenByAdmin = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      admin,
    );
    expect(seenByAdmin).toEqual({ probeTransport: "x", probeOpenTransport: "open" });

    const seenByUser = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      plainUser(713),
    );
    expect(seenByUser).toEqual({ probeOpenTransport: "open" });
  });

  test("hides an inheritedToTenant:false platform selection from tenant-side callers", async () => {
    const systemAdmin = createTestUser({
      id: 715,
      tenantId: testTenantId(715),
      roles: ["SystemAdmin"],
    });
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "probe-platform-transport:config:provider", value: "platform-smtp", scope: "system" },
      systemAdmin,
    );

    const seenByTenantAdmin = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      tenantAdmin(715),
    );
    expect(seenByTenantAdmin).toEqual({});

    const seenBySystemAdmin = await stack.http.queryOk<Record<string, string>>(
      ConfigQueries.selectedExtensions,
      {},
      systemAdmin,
    );
    expect(seenBySystemAdmin["probePlatformTransport"]).toBe("platform-smtp");
  });

  test("rejects a payload with extra fields such as tenantId", async () => {
    const err = await stack.http.queryErr(
      ConfigQueries.selectedExtensions,
      { tenantId: testTenantId(999) },
      tenantAdmin(714),
    );
    expect(err.httpStatus).toBe(400);
  });
});
