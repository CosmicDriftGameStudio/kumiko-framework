// fw#2859/#2876 — ctx.queryAs/ctx.writeAs to anyone but the caller itself (or a role subset) needs
// r.systemScope() or { escapeHatch }. Real HTTP calls + setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  HookPhases,
} from "../../engine";
import type { HandlerContext, SessionUser } from "../../engine/types";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";

const user = TestUsers.user;
const otherUserNoRole: SessionUser = createTestUser({
  id: 50,
  tenantId: user.tenantId,
  roles: ["User"],
});
const otherUserWithAdminRole: SessionUser = createTestUser({
  id: 51,
  tenantId: user.tenantId,
  roles: ["Admin"],
});

const multiRoleUser: SessionUser = createTestUser({
  id: 52,
  tenantId: user.tenantId,
  roles: ["User", "Editor"],
});

function foreignTenantTwin(caller: SessionUser): SessionUser {
  return { ...caller, tenantId: TestUsers.otherTenant.tenantId };
}

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

const hookThingEntity = createEntity({
  table: "idswitch_hook_things",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const hookThingTable = buildEntityTable("hookThing", hookThingEntity);
const hookThingExecutor = createEventStoreExecutor(hookThingTable, hookThingEntity, {
  entityName: "hookThing",
});

const hookNoEscapeHatchOutcomes: Array<{ readonly threw: boolean }> = [];
const hookWithEscapeHatchOutcomes: Array<{ readonly ok: boolean }> = [];
const hookForeignNoEscapeHatchOutcomes: Array<{ readonly threw: boolean }> = [];

const probeFeature = defineFeature("idswitch-probe", (r) => {
  r.entity("hookThing", hookThingEntity);

  // --- Targets ---
  r.queryHandler(
    "whoami",
    z.object({}),
    async (query) => ({
      roles: query.user.roles,
      tenantId: query.user.tenantId,
    }),
    { access: { roles: ["system", "User"] } },
  );

  r.writeHandler(
    "whoami-write",
    z.object({}),
    async (event) => ({
      isSuccess: true as const,
      data: { roles: event.user.roles, tenantId: event.user.tenantId },
    }),
    { access: { roles: ["system", "User"] } },
  );

  r.queryHandler("admin-only", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
  });

  // --- ctx.resolveActiveMembership: gated the same as a SYSTEM queryAs/writeAs ---
  r.queryHandler(
    "resolve-active-membership-no-hatch",
    z.object({}),
    async (query, ctx) => ctx.resolveActiveMembership(query.user.id, query.user.tenantId),
    { access: { roles: ["User"] } },
  );

  r.queryHandler(
    "resolve-active-membership-with-hatch",
    z.object({}),
    async (query, ctx) => ctx.resolveActiveMembership(query.user.id, query.user.tenantId),
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: needs SYSTEM to resolve membership" },
    },
  );

  // --- Direct SYSTEM switch: gated by the CALLING handler's own escapeHatch ---
  r.writeHandler(
    "write-as-system-no-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["User"] } },
  );

  r.writeHandler(
    "write-as-system-with-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "idswitch-probe:write:whoami-write", {}),
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: needs SYSTEM to look itself up" },
    },
  );

  r.queryHandler(
    "query-as-system-no-hatch",
    z.object({}),
    async (query, ctx) =>
      ctx.queryAs(createSystemUser(query.user.tenantId), "idswitch-probe:query:whoami", {}),
    { access: { roles: ["User"] } },
  );

  r.queryHandler(
    "query-as-system-with-hatch",
    z.object({}),
    async (query, ctx) =>
      ctx.queryAs(createSystemUser(query.user.tenantId), "idswitch-probe:query:whoami", {}),
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: needs SYSTEM to look itself up" },
    },
  );

  // --- Non-SYSTEM switch (fw#2876): only the caller itself (or a role subset) is free ---
  r.queryHandler(
    "query-as-self",
    z.object({ roles: z.array(z.string()).optional() }),
    async (query, ctx) =>
      ctx.queryAs(
        query.payload.roles ? { ...query.user, roles: query.payload.roles } : query.user,
        "idswitch-probe:query:whoami",
        {},
      ),
    { access: { roles: ["User"] } },
  );

  r.queryHandler(
    "query-as-normal-user",
    z.object({}),
    async (_query, ctx) =>
      ctx.queryAs(otherUserWithAdminRole, "idswitch-probe:query:admin-only", {}),
    { access: { roles: ["User"] } },
  );

  r.queryHandler(
    "query-as-normal-user-with-hatch",
    z.object({ granted: z.boolean() }),
    async (query, ctx) =>
      ctx.queryAs(
        query.payload.granted ? otherUserWithAdminRole : otherUserNoRole,
        "idswitch-probe:query:admin-only",
        {},
      ),
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: reads admin-only data as a named colleague" },
    },
  );

  r.writeHandler(
    "write-as-foreign-tenant",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["User"] } },
  );

  r.writeHandler(
    "write-as-foreign-tenant-with-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: acts for the same user inside a second tenant" },
    },
  );

  // Reached through outer-with-hatch as a colleague — must not inherit the outer grant.
  r.writeHandler(
    "inner-foreign-no-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["User"] } },
  );

  r.writeHandler(
    "outer-as-colleague-with-hatch",
    z.object({}),
    async (_event, ctx) =>
      ctx.writeAs(otherUserNoRole, "idswitch-probe:write:inner-foreign-no-hatch", {}),
    { access: { roles: ["User"] }, escapeHatch: { reason: "test: outer acts as a colleague" } },
  );

  // --- Nested: no transitive grant ---
  r.writeHandler(
    "inner-no-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["system"] } },
  );

  r.writeHandler(
    "inner-with-hatch",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["system"] }, escapeHatch: { reason: "test: inner needs SYSTEM" } },
  );

  r.writeHandler(
    "outer-with-hatch",
    z.object({ innerHasHatch: z.boolean() }),
    async (event, ctx) =>
      ctx.writeAs(
        createSystemUser(event.user.tenantId),
        event.payload.innerHasHatch
          ? "idswitch-probe:write:inner-with-hatch"
          : "idswitch-probe:write:inner-no-hatch",
        {},
      ),
    { access: { roles: ["User"] }, escapeHatch: { reason: "test: outer needs SYSTEM" } },
  );

  // --- Hooks: gated independently of the handler they fire on ---
  r.writeHandler(
    "hook-target-with-hatch",
    z.object({ label: z.string() }),
    async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["User"] }, escapeHatch: { reason: "test: handler needs SYSTEM" } },
  );

  r.writeHandler(
    "hook-target-without-hatch",
    z.object({ label: z.string() }),
    async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["User"] } },
  );

  // Hook on the WITH-hatch handler, but the hook itself declares NO
  // escapeHatch — must NOT inherit the handler's grant.
  r.hook(
    "postSave",
    "hook-target-with-hatch",
    async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      try {
        await handlerCtx.writeAs(
          createSystemUser(user.tenantId),
          "idswitch-probe:write:whoami-write",
          {},
        );
        hookNoEscapeHatchOutcomes.push({ threw: false });
      } catch (err) {
        hookNoEscapeHatchOutcomes.push({ threw: true });
        throw err;
      }
    },
    { phase: HookPhases.inTransaction },
  );

  // Hook on the WITHOUT-hatch handler, but the hook itself DOES declare
  // escapeHatch — must reach SYSTEM even though the handler can't.
  r.hook(
    "postSave",
    "hook-target-without-hatch",
    async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      const res = await handlerCtx.writeAs(
        createSystemUser(user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      );
      hookWithEscapeHatchOutcomes.push({ ok: res.isSuccess });
    },
    { phase: HookPhases.inTransaction, escapeHatch: { reason: "test: hook needs SYSTEM" } },
  );

  r.writeHandler(
    "hook-foreign-target-with-hatch",
    z.object({ label: z.string() }),
    async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["User"] }, escapeHatch: { reason: "test: handler acts cross-tenant" } },
  );

  r.hook(
    "postSave",
    "hook-foreign-target-with-hatch",
    async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      try {
        await handlerCtx.writeAs(foreignTenantTwin(user), "idswitch-probe:write:whoami-write", {});
        hookForeignNoEscapeHatchOutcomes.push({ threw: false });
      } catch (err) {
        hookForeignNoEscapeHatchOutcomes.push({ threw: true });
        throw err;
      }
    },
    { phase: HookPhases.inTransaction },
  );
});

const systemScopeFeature = defineFeature("idswitch-probe-system", (r) => {
  r.systemScope();

  r.writeHandler(
    "write-as-system",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "idswitch-probe:write:whoami-write", {}),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "write-as-foreign-tenant",
    z.object({}),
    async (event, ctx) =>
      ctx.writeAs(
        { ...foreignTenantTwin(event.user), roles: ["User"] },
        "idswitch-probe:write:whoami-write",
        {},
      ),
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature, systemScopeFeature] });
  await unsafeCreateEntityTable(stack.db, hookThingEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ctx.writeAs(SYSTEM, ...) — gated by the calling handler's escapeHatch", () => {
  test("WITHOUT escapeHatch: fails with access_denied", async () => {
    const err = await stack.http.writeErr(
      "idswitch-probe:write:write-as-system-no-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("WITH escapeHatch: succeeds", async () => {
    const result = await stack.http.writeOk<{ roles: readonly string[] }>(
      "idswitch-probe:write:write-as-system-with-hatch",
      {},
      user,
    );
    expect(result.roles).toContain("system");
  });
});

describe("ctx.queryAs(SYSTEM, ...) — gated by the calling handler's escapeHatch", () => {
  test("WITHOUT escapeHatch: fails with access_denied", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:query-as-system-no-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("WITH escapeHatch: succeeds", async () => {
    const result = await stack.http.queryOk<{ roles: readonly string[] }>(
      "idswitch-probe:query:query-as-system-with-hatch",
      {},
      user,
    );
    expect(result.roles).toContain("system");
  });
});

describe("ctx.resolveActiveMembership — gated like a SYSTEM queryAs/writeAs", () => {
  test("WITHOUT escapeHatch: fails with access_denied", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:resolve-active-membership-no-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("WITH escapeHatch: the SYSTEM-identity gate lets the call through (no membershipQuery wired here, so it fails downstream instead)", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:resolve-active-membership-with-hatch",
      {},
      user,
    );
    expect(err.code).not.toBe("access_denied");
  });
});

describe("ctx.queryAs/writeAs to a non-SYSTEM identity (fw#2876)", () => {
  test("switching to the caller itself is free", async () => {
    const result = await stack.http.queryOk<{ roles: readonly string[]; tenantId: string }>(
      "idswitch-probe:query:query-as-self",
      {},
      multiRoleUser,
    );
    expect(result.roles).toEqual(["User", "Editor"]);
    expect(result.tenantId).toBe(multiRoleUser.tenantId);
  });

  test("a subset of the caller's roles is free", async () => {
    const result = await stack.http.queryOk<{ roles: readonly string[] }>(
      "idswitch-probe:query:query-as-self",
      { roles: ["User"] },
      multiRoleUser,
    );
    expect(result.roles).toEqual(["User"]);
  });

  test("an additional role without escapeHatch is denied", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:query-as-self",
      { roles: ["User", "Admin"] },
      multiRoleUser,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("identity_switch_denied");
  });

  test("a foreign user id without escapeHatch is denied, even when that user could read the target", async () => {
    const err = await stack.http.queryErr("idswitch-probe:query:query-as-normal-user", {}, user);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("identity_switch_denied");
  });

  test("writeAs with a foreign tenantId without escapeHatch answers 403 access_denied", async () => {
    const err = await stack.http.writeErr("idswitch-probe:write:write-as-foreign-tenant", {}, user);
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("identity_switch_denied");
    expect(JSON.stringify(err)).not.toContain(TestUsers.otherTenant.tenantId);
  });

  test("writeAs with a foreign tenantId WITH escapeHatch runs in that tenant", async () => {
    const result = await stack.http.writeOk<{ tenantId: string }>(
      "idswitch-probe:write:write-as-foreign-tenant-with-hatch",
      {},
      user,
    );
    expect(result.tenantId).toBe(TestUsers.otherTenant.tenantId);
  });

  test("WITH escapeHatch the target's own access check still applies: denied when the target user lacks the role", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:query-as-normal-user-with-hatch",
      { granted: false },
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).not.toBe("identity_switch_denied");
  });

  test("WITH escapeHatch: allowed when the target user has the role", async () => {
    const result = await stack.http.queryOk<{ ok: boolean }>(
      "idswitch-probe:query:query-as-normal-user-with-hatch",
      { granted: true },
      user,
    );
    expect(result.ok).toBe(true);
  });

  test("no transitive grant: outer-with-hatch -> colleague -> inner-no-hatch cross-tenant writeAs is denied", async () => {
    const err = await stack.http.writeErr(
      "idswitch-probe:write:outer-as-colleague-with-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("identity_switch_denied");
  });

  test("hook without escapeHatch does not inherit the handler's grant for a cross-tenant writeAs", async () => {
    hookForeignNoEscapeHatchOutcomes.length = 0;
    const err = await stack.http.writeErr(
      "idswitch-probe:write:hook-foreign-target-with-hatch",
      { label: "should-roll-back" },
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(hookForeignNoEscapeHatchOutcomes).toEqual([{ threw: true }]);
  });
});

describe("r.systemScope() feature — no escapeHatch needed", () => {
  test("writeAs with a foreign tenantId succeeds from a systemScope handler", async () => {
    const result = await stack.http.writeOk<{ tenantId: string }>(
      "idswitch-probe-system:write:write-as-foreign-tenant",
      {},
      TestUsers.admin,
    );
    expect(result.tenantId).toBe(TestUsers.otherTenant.tenantId);
  });

  test("writeAs(SYSTEM) succeeds from a systemScope handler", async () => {
    const result = await stack.http.writeOk<{ roles: readonly string[] }>(
      "idswitch-probe-system:write:write-as-system",
      {},
      TestUsers.admin,
    );
    expect(result.roles).toContain("system");
  });
});

describe("nested identity switches — no transitive grant", () => {
  test("outer-with-hatch -> inner-no-hatch -> target: overall fails with access_denied", async () => {
    const err = await stack.http.writeErr(
      "idswitch-probe:write:outer-with-hatch",
      { innerHasHatch: false },
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("outer-with-hatch -> inner-with-hatch -> target: succeeds (control)", async () => {
    const result = await stack.http.writeOk<{ roles: readonly string[] }>(
      "idswitch-probe:write:outer-with-hatch",
      { innerHasHatch: true },
      user,
    );
    expect(result.roles).toContain("system");
  });
});

describe("hooks are gated independently of the handler they fire on", () => {
  test("hook WITHOUT escapeHatch does not inherit the handler's grant: overall write fails", async () => {
    hookNoEscapeHatchOutcomes.length = 0;
    const err = await stack.http.writeErr(
      "idswitch-probe:write:hook-target-with-hatch",
      { label: "should-roll-back" },
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(hookNoEscapeHatchOutcomes).toEqual([{ threw: true }]);
  });

  test("hook WITH escapeHatch reaches SYSTEM even when the handler itself has none", async () => {
    hookWithEscapeHatchOutcomes.length = 0;
    const result = await stack.http.writeOk<{ id: string }>(
      "idswitch-probe:write:hook-target-without-hatch",
      { label: "should-commit" },
      user,
    );
    expect(result.id).toBeDefined();
    expect(hookWithEscapeHatchOutcomes).toEqual([{ ok: true }]);
  });
});
