// ctx.dispatch.queryAs/ctx.dispatch.writeAs to anyone but the caller itself (or a role subset) needs
// r.systemScope() or { escapeHatch }. Real HTTP calls + setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/index.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  defineWriteHandler,
  HookPhases,
  stepsPipeline,
} from "../../engine/index.ts";
import type { HandlerContext, SessionUser } from "../../engine/types/index.ts";
import { createTestUser, TestUsers } from "../../seeding/seed-users.ts";

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

type AuthClaimsSwitchOutcome = {
  readonly selfOk: boolean;
  readonly foreignReason: string | undefined;
};
const authClaimsSwitchOutcomes: AuthClaimsSwitchOutcome[] = [];

const probeFeature = defineFeature("idswitch-probe", (r) => {
  r.entity({ name: "hookThing", ...hookThingEntity });
  r.requires.step("callFeature");

  // --- r.authClaims hook: queryAs reaches only the claims user itself ---
  r.authClaims(async (claimsUser, ctx) => {
    const self = await ctx.queryAs(claimsUser, "idswitch-probe:query:whoami", {});
    let foreignReason: string | undefined;
    try {
      await ctx.queryAs(
        { ...claimsUser, tenantId: TestUsers.otherTenant.tenantId },
        "idswitch-probe:query:whoami",
        {},
      );
    } catch (err) {
      foreignReason = errorReason((err as { details?: unknown }).details);
    }
    authClaimsSwitchOutcomes.push({ selfOk: self !== undefined, foreignReason });
    return {};
  });

  // --- r.step.callFeature({ as }): gated like ctx.dispatch.writeAs by the handler's escapeHatch ---
  r.writeHandler(
    defineWriteHandler({
      name: "step-call-as-colleague-no-hatch",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: stepsPipeline<Record<string, never>, { roles: readonly string[] }>(({ r: step }) => [
        step.step.callFeature("inner", {
          handler: "idswitch-probe:write:whoami-write",
          payload: () => ({}),
          as: otherUserNoRole,
        }),
        step.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: steps["inner"] as { roles: readonly string[] },
        })),
      ]),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "step-call-as-colleague-with-hatch",
      schema: z.object({}),
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: step acts as a named colleague" },
      perform: stepsPipeline<Record<string, never>, { roles: readonly string[] }>(({ r: step }) => [
        step.step.callFeature("inner", {
          handler: "idswitch-probe:write:whoami-write",
          payload: () => ({}),
          as: otherUserNoRole,
        }),
        step.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: steps["inner"] as { roles: readonly string[] },
        })),
      ]),
    }),
  );

  // --- Targets ---
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    handler: async (query) => ({
      roles: query.user.roles,
      tenantId: query.user.tenantId,
    }),
    access: { roles: ["system", "User"] },
  });

  r.writeHandler({
    name: "whoami-write",
    schema: z.object({}),
    handler: async (event) => ({
      isSuccess: true as const,
      data: { roles: event.user.roles, tenantId: event.user.tenantId },
    }),
    access: { roles: ["system", "User"] },
  });

  r.queryHandler({
    name: "admin-only",
    schema: z.object({}),
    handler: async () => ({ ok: true }),
    access: { roles: ["Admin"] },
  });

  // --- ctx.auth.resolveActiveMembership: gated the same as a SYSTEM queryAs/writeAs ---
  r.queryHandler({
    name: "resolve-active-membership-no-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.auth.resolveActiveMembership(query.user.id, query.user.tenantId),
    access: { roles: ["User"] },
  });

  r.queryHandler({
    name: "resolve-active-membership-with-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.auth.resolveActiveMembership(query.user.id, query.user.tenantId),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: needs SYSTEM to resolve membership" },
  });

  // --- escapeHatch.grants narrows what the declaration unlocks ---
  r.writeHandler({
    name: "write-as-system-raw-only-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: raw reads only", grants: ["unsafeRaw"] },
  });

  r.queryHandler({
    name: "query-as-system-raw-only-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        createSystemUser(query.user.tenantId),
        "idswitch-probe:query:whoami",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: raw reads only", grants: ["unsafeRaw"] },
  });

  r.queryHandler({
    name: "query-as-system-identity-grant-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        createSystemUser(query.user.tenantId),
        "idswitch-probe:query:whoami",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: needs SYSTEM", grants: ["systemIdentity"] },
  });

  // --- Direct SYSTEM switch: gated by the CALLING handler's own escapeHatch ---
  r.writeHandler({
    name: "write-as-system-no-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["User"] },
  });

  r.writeHandler({
    name: "write-as-system-with-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: needs SYSTEM to look itself up" },
  });

  r.queryHandler({
    name: "query-as-system-no-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        createSystemUser(query.user.tenantId),
        "idswitch-probe:query:whoami",
        {},
      ),
    access: { roles: ["User"] },
  });

  r.queryHandler({
    name: "query-as-system-with-hatch",
    schema: z.object({}),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        createSystemUser(query.user.tenantId),
        "idswitch-probe:query:whoami",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: needs SYSTEM to look itself up" },
  });

  // --- Non-SYSTEM switch: only the caller itself (or a role subset) is free ---
  r.queryHandler({
    name: "query-as-self",
    schema: z.object({ roles: z.array(z.string()).optional() }),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        query.payload.roles ? { ...query.user, roles: query.payload.roles } : query.user,
        "idswitch-probe:query:whoami",
        {},
      ),
    access: { roles: ["User"] },
  });

  r.queryHandler({
    name: "query-as-normal-user",
    schema: z.object({}),
    handler: async (_query, ctx) =>
      ctx.dispatch.queryAs(otherUserWithAdminRole, "idswitch-probe:query:admin-only", {}),
    access: { roles: ["User"] },
  });

  r.queryHandler({
    name: "query-as-normal-user-with-hatch",
    schema: z.object({ granted: z.boolean() }),
    handler: async (query, ctx) =>
      ctx.dispatch.queryAs(
        query.payload.granted ? otherUserWithAdminRole : otherUserNoRole,
        "idswitch-probe:query:admin-only",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: reads admin-only data as a named colleague" },
  });

  r.writeHandler({
    name: "write-as-foreign-tenant",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    access: { roles: ["User"] },
  });

  r.writeHandler({
    name: "write-as-foreign-tenant-with-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: acts for the same user inside a second tenant" },
  });

  // Reached through outer-with-hatch as a colleague — must not inherit the outer grant.
  r.writeHandler({
    name: "inner-foreign-no-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(foreignTenantTwin(event.user), "idswitch-probe:write:whoami-write", {}),
    access: { roles: ["User"] },
  });

  r.writeHandler({
    name: "outer-as-colleague-with-hatch",
    schema: z.object({}),
    handler: async (_event, ctx) =>
      ctx.dispatch.writeAs(otherUserNoRole, "idswitch-probe:write:inner-foreign-no-hatch", {}),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: outer acts as a colleague" },
  });

  // --- Nested: no transitive grant ---
  r.writeHandler({
    name: "inner-no-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["system"] },
  });

  r.writeHandler({
    name: "inner-with-hatch",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["system"] },
    escapeHatch: { reason: "test: inner needs SYSTEM" },
  });

  r.writeHandler({
    name: "outer-with-hatch",
    schema: z.object({ innerHasHatch: z.boolean() }),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        event.payload.innerHasHatch
          ? "idswitch-probe:write:inner-with-hatch"
          : "idswitch-probe:write:inner-no-hatch",
        {},
      ),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: outer needs SYSTEM" },
  });

  // --- Hooks: gated independently of the handler they fire on ---
  r.writeHandler({
    name: "hook-target-with-hatch",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: handler needs SYSTEM" },
  });

  r.writeHandler({
    name: "hook-target-without-hatch",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["User"] },
  });

  // Hook on the WITH-hatch handler, but the hook itself declares NO
  // escapeHatch — must NOT inherit the handler's grant.
  r.hook({
    type: "postSave",
    target: "hook-target-with-hatch",
    handler: async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      try {
        await handlerCtx.dispatch.writeAs(
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
    phase: HookPhases.inTransaction,
  });

  // Hook on the WITHOUT-hatch handler, but the hook itself DOES declare
  // escapeHatch — must reach SYSTEM even though the handler can't.
  r.hook({
    type: "postSave",
    target: "hook-target-without-hatch",
    handler: async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      const res = await handlerCtx.dispatch.writeAs(
        createSystemUser(user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      );
      hookWithEscapeHatchOutcomes.push({ ok: res.isSuccess });
    },
    phase: HookPhases.inTransaction,
    escapeHatch: { reason: "test: hook needs SYSTEM" },
  });

  r.writeHandler({
    name: "hook-foreign-target-with-hatch",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => hookThingExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["User"] },
    escapeHatch: { reason: "test: handler acts cross-tenant" },
  });

  r.hook({
    type: "postSave",
    target: "hook-foreign-target-with-hatch",
    handler: async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext;
      try {
        await handlerCtx.dispatch.writeAs(
          foreignTenantTwin(user),
          "idswitch-probe:write:whoami-write",
          {},
        );
        hookForeignNoEscapeHatchOutcomes.push({ threw: false });
      } catch (err) {
        hookForeignNoEscapeHatchOutcomes.push({ threw: true });
        throw err;
      }
    },
    phase: HookPhases.inTransaction,
  });
});

const systemScopeFeature = defineFeature("idswitch-probe-system", (r) => {
  r.systemScope();

  r.writeHandler({
    name: "write-as-system",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "write-as-foreign-tenant",
    schema: z.object({}),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(
        { ...foreignTenantTwin(event.user), roles: ["User"] },
        "idswitch-probe:write:whoami-write",
        {},
      ),
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature, systemScopeFeature] });
  await unsafeCreateEntityTable(stack.db, hookThingEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ctx.dispatch.writeAs(SYSTEM, ...) — gated by the calling handler's escapeHatch", () => {
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

describe("ctx.dispatch.queryAs(SYSTEM, ...) — gated by the calling handler's escapeHatch", () => {
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

describe("escapeHatch.grants", () => {
  test("grants: [unsafeRaw] does not unlock writeAs(SYSTEM)", async () => {
    const err = await stack.http.writeErr(
      "idswitch-probe:write:write-as-system-raw-only-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("grants: [unsafeRaw] does not unlock queryAs(SYSTEM)", async () => {
    const err = await stack.http.queryErr(
      "idswitch-probe:query:query-as-system-raw-only-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
  });

  test("grants: [systemIdentity] unlocks queryAs(SYSTEM)", async () => {
    const result = await stack.http.queryOk<{ roles: readonly string[] }>(
      "idswitch-probe:query:query-as-system-identity-grant-hatch",
      {},
      user,
    );
    expect(result.roles).toContain("system");
  });

  test("an escapeHatch without grants keeps unlocking everything", async () => {
    const result = await stack.http.queryOk<{ roles: readonly string[] }>(
      "idswitch-probe:query:query-as-system-with-hatch",
      {},
      user,
    );
    expect(result.roles).toContain("system");
  });
});

describe("ctx.auth.resolveActiveMembership — gated like a SYSTEM queryAs/writeAs", () => {
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

describe("ctx.dispatch.queryAs/writeAs to a non-SYSTEM identity", () => {
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
      { label: "should-roll-back-foreign" },
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(hookForeignNoEscapeHatchOutcomes).toEqual([{ threw: true }]);
    // The hook ran inside the write's transaction: its denial must undo the write.
    expect(
      await selectMany(stack.db, hookThingTable, { label: "should-roll-back-foreign" }),
    ).toEqual([]);
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
    expect(await selectMany(stack.db, hookThingTable, { label: "should-roll-back" })).toEqual([]);
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

describe("r.authClaims hook context — queryAs only reaches the claims user itself", () => {
  test("queryAs(self) passes, queryAs(foreign tenant) is denied with identity_switch_denied", async () => {
    authClaimsSwitchOutcomes.length = 0;

    await stack.dispatcher.resolveAuthClaims(user);

    expect(authClaimsSwitchOutcomes).toEqual([
      { selfOk: true, foreignReason: "identity_switch_denied" },
    ]);
  });
});

describe("r.step.callFeature({ as }) — gated by the handler's escapeHatch", () => {
  test("a colleague as WITHOUT escapeHatch is denied with identity_switch_denied", async () => {
    const err = await stack.http.writeErr(
      "idswitch-probe:write:step-call-as-colleague-no-hatch",
      {},
      user,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("identity_switch_denied");
  });

  test("a colleague as WITH escapeHatch runs", async () => {
    const result = await stack.http.writeOk<{ roles: readonly string[] }>(
      "idswitch-probe:write:step-call-as-colleague-with-hatch",
      {},
      user,
    );
    expect(result.roles).toEqual(otherUserNoRole.roles);
  });
});
