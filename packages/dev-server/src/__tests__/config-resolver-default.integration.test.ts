import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  access,
  createTenantConfig,
  defineFeature,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { mergeConfigResolverDefault } from "../run-dev-app";

// Pins runDevApp's ENV→config-app-override wiring: mergeConfigResolverDefault
// builds the auth-mode configResolver-default with the ENV bridge (a key with
// `env:` gets its env value as the app-override default, symmetric to
// runProdApp), the envSource is injected (never the real process.env), and a
// caller-supplied configResolver still overrides the default.

const PAGE_SIZE = "devcfg:config:page-size";

// Reads ctx.config directly — the exact consumption seam mergeConfigResolverDefault
// wires the dispatcher through. Every other test in this file inspects the returned
// {configResolver, _configAccessorFactory} object without ever dispatching a handler
// that actually reads ctx.config; a "Boot writes field A, dispatcher expects field B"
// drift (the original #359-adjacent bug class) would be invisible to all of them.
const readPageSizeQuery = defineQueryHandler({
  name: "read-page-size",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (_query, ctx) => ({ pageSize: await ctx.config?.(PAGE_SIZE) }),
});

const devcfgFeature = defineFeature("devcfg", (r) => {
  r.requires("config");
  r.config({
    keys: {
      pageSize: createTenantConfig("number", {
        env: "DEVCFG_PAGE_SIZE",
        default: 10,
        read: access.all,
        write: access.all,
      }),
    },
  });
  r.queryHandler(readPageSizeQuery);
});

// ctx=undefined → object form, configResolver is the only key (test boundary).
type ExtraObj = { configResolver: ReturnType<typeof createConfigResolver> };

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), devcfgFeature],
    extraContext: ({ registry }) => {
      const bootResolver = createConfigResolver();
      return {
        configResolver: bootResolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, bootResolver),
      };
    },
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

function resolverFor(envSource: Record<string, string | undefined>) {
  const extra = mergeConfigResolverDefault(undefined, stack.registry, envSource) as ExtraObj;
  return extra.configResolver;
}

function peekPageSize(resolver: ReturnType<typeof createConfigResolver>) {
  const keyDef = stack.registry.getConfigKey(PAGE_SIZE);
  if (!keyDef) throw new Error("page-size key missing from registry");
  return resolver.get(
    PAGE_SIZE,
    keyDef,
    TestUsers.systemAdmin.tenantId,
    TestUsers.systemAdmin.id,
    stack.db,
  );
}

describe("runDevApp configResolver-default — ENV→app-override bridge", () => {
  test("a key with `env:` resolves to the injected env value as app-override", async () => {
    const value = await peekPageSize(resolverFor({ DEVCFG_PAGE_SIZE: "25" }));
    expect(value).toBe(25); // number, coerced from env — not 10 (keyDef.default)
  });

  test("no env value → falls to keyDef.default (bridge is conditional, not always-on)", async () => {
    const value = await peekPageSize(resolverFor({}));
    expect(value).toBe(10);
  });

  test("a caller-supplied configResolver overrides the default", () => {
    const custom = createConfigResolver();
    const extra = mergeConfigResolverDefault({ configResolver: custom }, stack.registry, {
      DEVCFG_PAGE_SIZE: "25",
    }) as ExtraObj;
    expect(extra.configResolver).toBe(custom);
  });

  // Regression: the GDPR export download threw errors.internal in prod because
  // boot only wired `configResolver`, never `_configAccessorFactory` — so the
  // dispatcher left ctx.config undefined and createFileProviderForTenant threw
  // "ctx.config is missing". The boot now mints the factory.
  test("boot wiring mints _configAccessorFactory so handlers get ctx.config", () => {
    const extra = mergeConfigResolverDefault(undefined, stack.registry, {}) as ExtraObj & {
      readonly _configAccessorFactory?: unknown;
    };
    expect(typeof extra._configAccessorFactory).toBe("function");
  });

  test("_configAccessorFactory uses the EFFECTIVE resolver (caller override wins over env-bridge)", async () => {
    // money-horse pins `file-foundation:config:provider` = "s3-env" via an
    // appOverride on its own configResolver; ctx.config MUST read that override,
    // not the boot default — else the download resolves no provider.
    const override = createConfigResolver({ appOverrides: new Map([[PAGE_SIZE, "99"]]) });
    const extra = mergeConfigResolverDefault({ configResolver: override }, stack.registry, {
      DEVCFG_PAGE_SIZE: "25", // env-bridge default would be 25 — the override must win
    }) as ExtraObj & {
      readonly _configAccessorFactory: (deps: {
        readonly user: { readonly id: string; readonly tenantId: string };
        readonly db: typeof stack.db;
      }) => (key: string) => Promise<unknown>;
    };
    const accessor = extra._configAccessorFactory({
      user: { id: TestUsers.systemAdmin.id, tenantId: TestUsers.systemAdmin.tenantId },
      db: stack.db,
    });
    // appOverride values come through raw (string) — what matters is it's the
    // override's "99", NOT the env-bridge default ("25"): proves the factory
    // was built from the caller's resolver, exactly like money-horse's "s3-env".
    expect(await accessor(PAGE_SIZE)).toBe("99");
  });

  test("a real dispatch through stack.http resolves ctx.config end-to-end (not the factory called directly)", async () => {
    // Every test above calls mergeConfigResolverDefault()/_configAccessorFactory
    // directly — none go through an actual dispatched request. The original bug
    // this feature guards against ("boot writes configResolver, dispatcher reads
    // a different field") only manifests on a REAL dispatch, where the
    // dispatcher's own wiring (not test code) builds ctx.config from
    // _configAccessorFactory. This is that missing end-to-end proof.
    const res = await stack.http.queryOk<{ pageSize: number | undefined }>(
      "devcfg:query:read-page-size",
      {},
      TestUsers.systemAdmin,
    );
    expect(res.pageSize).toBe(10); // keyDef.default — no env override wired on this stack
  });
});
