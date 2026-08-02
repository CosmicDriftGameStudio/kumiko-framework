// buildHandlerContext resolves ctx.tz.tenant from tenant:config:timezone and
// ctx.tz.user from SessionUser.timezone (fw#1636). "tenant" here is a
// standalone probe feature registering the same qualified config key the
// real bundled `tenant` feature uses — decoupled from that feature's
// entities/handlers, but exercising the identical runtime path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

const tenantFeature = defineFeature("tenant", (r) => {
  r.requires("config");
  r.config({
    keys: {
      timezone: createTenantConfig("select", {
        default: "UTC",
        options: ["UTC", "Europe/Berlin", "Asia/Tokyo"],
        write: access.roles("Admin"),
      }),
    },
  });
});

const probeFeature = defineFeature("probe", (r) => {
  r.requires("tenant");
  r.writeHandler(
    "read-tz",
    z.object({}),
    async (_event, ctx) => ({
      isSuccess: true,
      data: { tenant: ctx.tz.tenant, user: ctx.tz.user },
    }),
    { access: { openToAll: true } },
  );
});

describe("buildHandlerContext ctx.tz resolution", () => {
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), tenantFeature, probeFeature],
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

  test("defaults to UTC when no tenant config value is set and SessionUser has no timezone", async () => {
    const user = createTestUser({ id: 10 });
    const res = await stack.http.writeOk<{ tenant: string; user: string }>(
      "probe:write:read-tz",
      {},
      user,
    );
    expect(res).toEqual({ tenant: "UTC", user: "UTC" });
  });

  test("ctx.tz.tenant reads tenant:config:timezone", async () => {
    const admin = createTestUser({ id: 11, roles: ["Admin"] });
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Europe/Berlin" },
      admin,
    );

    const res = await stack.http.writeOk<{ tenant: string; user: string }>(
      "probe:write:read-tz",
      {},
      admin,
    );
    expect(res).toEqual({ tenant: "Europe/Berlin", user: "Europe/Berlin" });
  });

  test("ctx.tz.user reads SessionUser.timezone independently of tenant", async () => {
    const admin = createTestUser({ id: 13, roles: ["Admin"] });
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Europe/Berlin" },
      admin,
    );

    const user = createTestUser({ id: 12, timezone: "Asia/Tokyo" });
    const res = await stack.http.writeOk<{ tenant: string; user: string }>(
      "probe:write:read-tz",
      {},
      user,
    );
    expect(res).toEqual({ tenant: "Europe/Berlin", user: "Asia/Tokyo" });
  });
});
