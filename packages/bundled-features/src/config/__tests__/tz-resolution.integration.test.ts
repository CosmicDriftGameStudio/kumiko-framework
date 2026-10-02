// buildHandlerContext resolves ctx.tz.tenant from tenant:config:timezone and
// ctx.tz.user from SessionUser.timezone (fw#1636). "tenant" here is a
// standalone probe feature registering the same qualified config key the
// real bundled `tenant` feature uses — decoupled from that feature's
// entities/handlers, but exercising the identical runtime path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { createConfigAccessorFactory, createConfigFeature } from "../feature.js";
import { createConfigResolver } from "../resolver.js";
import { configValuesTable } from "../table.js";

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
  // Sets the tenant timezone, lets a nested write resolve ctx.tz inside the same
  // still-open transaction, then fails so everything rolls back.
  r.writeHandler(
    "set-tz-then-fail",
    z.object({}),
    async (_event, ctx) => {
      await ctx.write("config:write:set", { key: "tenant:config:timezone", value: "Asia/Tokyo" });
      await ctx.write("probe:write:read-tz", {});
      return writeFailure(new UnprocessableError("rolled_back_on_purpose"));
    },
    { access: { roles: ["Admin"] } },
  );
  r.writeHandler(
    "read-tz",
    z.object({}),
    async (_event, ctx) => ({
      isSuccess: true,
      data: { tenant: ctx.tz.tenant, user: ctx.tz.user },
    }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
});

const rolledBackTenantId = testTenantId(77);

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

  test("a timezone read inside a rolled-back write transaction is never cached", async () => {
    const admin = createTestUser({ id: 14, roles: ["Admin"], tenantId: rolledBackTenantId });
    await stack.http.writeErr("probe:write:set-tz-then-fail", {}, admin);

    const res = await stack.http.writeOk<{ tenant: string }>("probe:write:read-tz", {}, admin);
    expect(res.tenant).toBe("UTC");
  });
});
