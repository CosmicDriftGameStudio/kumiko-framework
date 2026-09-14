// ctx.queryAsMember in Handler-, Hook- and Job-Context. Real HTTP + a real
// BullMQ worker via setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { HandlerContext, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
  HookPhases,
  SYSTEM_ROLE,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
  waitFor,
} from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { hashPassword } from "../../shared";
import {
  createTenantFeature,
  TenantHandlers,
  type TenantLifecycleStatus,
  tenantMembershipsTable,
} from "../../tenant";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { resetTenantLifecycleGateCacheForTests } from "../../tenant-lifecycle/lifecycle-gate";
import { createUserFeature, USER_STATUS, UserHandlers, userEntity, userTable } from "../../user";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

// ── Test fixture: an owner-scoped entity + probe handlers/hooks/job ────────

const noteEntity = createEntity({
  table: "qam_notes",
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture" }),
    body: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: {
    read: { Admin: "all", User: from("user:id", "ownerId") },
    write: { Admin: "all", User: from("user:id", "ownerId") },
  },
});

const hookNoteAEntity = createEntity({
  table: "qam_hook_note_a",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const hookNoteBEntity = createEntity({
  table: "qam_hook_note_b",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

const authClaimsCalls: string[] = [];
// Shared slot is safe: tests within this file run serially (bun:test default).
let hookTargetUserId = "";
const hookNoHatchOutcomes: Array<{ readonly threw: boolean }> = [];
const hookWithHatchResults: unknown[] = [];
const jobQueryAsMemberResults: unknown[] = [];

const WHOAMI_QN = "queryasmemberprobe:query:whoami";
const NOTE_LIST_QN = "queryasmemberprobe:query:note:list";
const TRIES_WRITE_QN = "queryasmemberprobe:query:tries-write";
const TRIES_APPEND_EVENT_QN = "queryasmemberprobe:query:tries-append-event";
const TRIES_FETCH_FOR_WRITING_QN = "queryasmemberprobe:query:tries-fetch-for-writing";
const TRIES_JOB_RUNNER_QN = "queryasmemberprobe:query:tries-job-runner";
const SYSTEM_SCOPE_READ_AS_MEMBER_QN = "queryasmembersystemscope:write:read-as-member";

const probeFeature = defineFeature("queryasmemberprobe", (r) => {
  r.entity("note", noteEntity);
  r.entity("hookNoteA", hookNoteAEntity);
  r.entity("hookNoteB", hookNoteBEntity);

  r.writeHandler(
    defineEntityWriteHandler("note:create", noteEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityQueryHandler("note:list", noteEntity, { access: { roles: ["Admin", "User"] } }),
  );

  r.queryHandler(
    "whoami",
    z.object({}),
    async (query) => ({
      id: query.user.id,
      roles: query.user.roles,
      claims: query.user.claims ?? null,
      sid: query.user.sid ?? null,
      origin: query.user.origin ?? null,
    }),
    { access: { roles: ["Admin", "User"] } },
  );

  // Target for the read-only-enforcement tests: a query handler reached via
  // ctx.queryAsMember that tries to write.
  r.queryHandler(
    "tries-write",
    z.object({}),
    async (_query, ctx) => ctx.write("queryasmemberprobe:write:note:create", { body: "nope" }),
    { access: { roles: ["Admin", "User"] } },
  );
  r.queryHandler(
    "tries-append-event",
    z.object({}),
    async (_query, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "qam-probe",
        type: "queryasmemberprobe:event:nope",
        payload: {},
      });
      return { ok: true };
    },
    { access: { roles: ["Admin", "User"] } },
  );
  r.queryHandler(
    "tries-fetch-for-writing",
    z.object({}),
    async (_query, ctx) => {
      const handle = await ctx.fetchForWriting({
        aggregateId: crypto.randomUUID(),
        aggregateType: "qam-probe",
      });
      await handle.appendOne({ type: "queryasmemberprobe:event:nope", payload: {} });
      return { ok: true };
    },
    { access: { roles: ["Admin", "User"] } },
  );
  r.queryHandler(
    "tries-job-runner",
    z.object({}),
    async (_query, ctx) => {
      const jobRunner = ctx["jobRunner"] as
        | { dispatch: (name: string, payload: Record<string, unknown>) => Promise<string> }
        | undefined;
      if (!jobRunner) return { ran: false };
      await jobRunner.dispatch("queryasmemberprobe:job:noop", {});
      return { ran: true };
    },
    { access: { roles: ["Admin", "User"] } },
  );

  // Caller-facing write handler that reads as a member — WITH and WITHOUT
  // escapeHatch (systemIdentitySwitchDenied gate).
  r.writeHandler(
    "read-as-member",
    z.object({
      userId: z.string(),
      targetQn: z.string(),
      payload: z.record(z.string(), z.unknown()).default({}),
    }),
    async (event, ctx) => {
      const data = await ctx.queryAsMember(
        event.payload.userId,
        event.payload.targetQn,
        event.payload.payload,
      );
      return { isSuccess: true as const, data };
    },
    { access: { roles: ["Admin"] }, escapeHatch: { reason: "test: reads as a stored member" } },
  );
  r.writeHandler(
    "read-as-member-no-hatch",
    z.object({
      userId: z.string(),
      targetQn: z.string(),
      payload: z.record(z.string(), z.unknown()).default({}),
    }),
    async (event, ctx) => {
      const data = await ctx.queryAsMember(
        event.payload.userId,
        event.payload.targetQn,
        event.payload.payload,
      );
      return { isSuccess: true as const, data };
    },
    { access: { roles: ["Admin"] } },
  );
  r.writeHandler(
    "read-as-member-twice",
    z.object({ userId: z.string() }),
    async (event, ctx) => {
      await ctx.queryAsMember(event.payload.userId, WHOAMI_QN, {});
      await ctx.queryAsMember(event.payload.userId, WHOAMI_QN, {});
      return { isSuccess: true as const, data: { ok: true } };
    },
    { access: { roles: ["Admin"] }, escapeHatch: { reason: "test: cache check" } },
  );
  r.writeHandler(
    "read-as-member-two-users",
    z.object({ userIdA: z.string(), userIdB: z.string() }),
    async (event, ctx) => {
      await ctx.queryAsMember(event.payload.userIdA, WHOAMI_QN, {});
      await ctx.queryAsMember(event.payload.userIdB, WHOAMI_QN, {});
      return { isSuccess: true as const, data: { ok: true } };
    },
    { access: { roles: ["Admin"] }, escapeHatch: { reason: "test: two-user cache check" } },
  );

  // authClaims — counter parity with cache + real-login-claims check.
  r.authClaims(async (user) => {
    authClaimsCalls.push(user.id);
    return { marker: user.id };
  });

  // A hook's own escapeHatch grants independently of the handler it fires on, in both directions.
  r.writeHandler({
    ...defineEntityWriteHandler("hook-note-a:create", hookNoteAEntity, {
      access: { roles: ["Admin"] },
    }),
    escapeHatch: { reason: "test: handler has its own grant" },
  });
  r.writeHandler(
    defineEntityWriteHandler("hook-note-b:create", hookNoteBEntity, {
      access: { roles: ["Admin"] },
    }),
  );

  r.hook(
    "postSave",
    "hook-note-a:create",
    async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext; // @cast-boundary: hook ctx is AppContext at the type level, but the dispatcher hands it a real HandlerContext at runtime
      try {
        await handlerCtx.queryAsMember(hookTargetUserId, WHOAMI_QN, {});
        hookNoHatchOutcomes.push({ threw: false });
      } catch (err) {
        hookNoHatchOutcomes.push({ threw: true });
        throw err;
      }
    },
    { phase: HookPhases.inTransaction },
  );
  r.hook(
    "postSave",
    "hook-note-b:create",
    async (_result, ctx) => {
      const handlerCtx = ctx as unknown as HandlerContext; // @cast-boundary: same as the hook-note-a probe above
      const res = await handlerCtx.queryAsMember(hookTargetUserId, WHOAMI_QN, {});
      hookWithHatchResults.push(res);
    },
    {
      phase: HookPhases.inTransaction,
      escapeHatch: { reason: "test: hook needs to read as a member" },
    },
  );

  // Jobs stay ungated.
  r.job("noop", { trigger: { manual: true }, retries: 0 }, async () => {});
  r.job("query-as-member-job", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const result = await ctx.queryAsMember(payload["userId"] as string, WHOAMI_QN, {}); // @cast-boundary dynamic-key
    jobQueryAsMemberResults.push(result);
  });
});

// A whole-feature r.systemScope() grants queryAsMember without an
// escapeHatch — isSystem alone sets allowSystemIdentity.
const systemScopeProbeFeature = defineFeature("queryasmembersystemscope", (r) => {
  r.systemScope();
  r.writeHandler(
    "read-as-member",
    z.object({ userId: z.string() }),
    async (event, ctx) => {
      const data = await ctx.queryAsMember(event.payload.userId, WHOAMI_QN, {});
      return { isSuccess: true as const, data };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;

const TENANT_A: TenantId = testTenantId(1);
const TENANT_B: TenantId = testTenantId(2);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createAuthEmailPasswordFeature(),
      probeFeature,
      systemScopeProbeFeature,
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
    jobs: { consumerLane: "worker" },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity);
  await unsafeCreateEntityTable(stack.db, hookNoteAEntity);
  await unsafeCreateEntityTable(stack.db, hookNoteBEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(stack.db, [
    userTable,
    tenantTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  authClaimsCalls.length = 0;
  hookNoHatchOutcomes.length = 0;
  hookWithHatchResults.length = 0;
  jobQueryAsMemberResults.length = 0;
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function createTenant(id: TenantId): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id, key: `t-${id.slice(-8)}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
}

async function setTenantStatus(id: TenantId, status: TenantLifecycleStatus): Promise<void> {
  await updateRows(stack.db, tenantTable, { status }, { id });
  resetTenantLifecycleGateCacheForTests();
}

async function createUser(email: string, password: string): Promise<string> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "user" },
    TestUsers.systemAdmin,
  );
  return created.id;
}

async function addMembership(
  userId: string,
  tenantId: TenantId,
  roles: readonly string[] = ["User"],
): Promise<void> {
  await seedTenantMembership(stack.db, { userId, tenantId, roles });
}

const admin: SessionUser = { ...TestUsers.admin, tenantId: TENANT_A };

async function readAsMember(
  userId: string,
  targetQn: string,
  payload: Record<string, unknown> = {},
) {
  return stack.http.writeOk<unknown>(
    "queryasmemberprobe:write:read-as-member",
    { userId, targetQn, payload },
    admin,
  );
}

async function readAsMemberErr(
  userId: string,
  targetQn: string,
  payload: Record<string, unknown> = {},
) {
  return stack.http.writeErr(
    "queryasmemberprobe:write:read-as-member",
    { userId, targetQn, payload },
    admin,
  );
}

async function createNote(ownerId: string, body: string): Promise<void> {
  await stack.http.writeOk("queryasmemberprobe:write:note:create", { ownerId, body }, admin);
}

// ── 1. Ownership — reading as a member applies THEIR row filters ──────────

describe("ctx.queryAsMember — ownership rules of the resolved member apply", () => {
  test("reading as user A returns only A's rows, reading as B only B's", async () => {
    await createTenant(TENANT_A);
    const userA = await createUser("owner-a@example.com", "pw-long-enough-1");
    const userB = await createUser("owner-b@example.com", "pw-long-enough-2");
    await addMembership(userA, TENANT_A);
    await addMembership(userB, TENANT_A);
    await createNote(userA, "a-note-1");
    await createNote(userA, "a-note-2");
    await createNote(userB, "b-note-1");

    const asA = (await readAsMember(userA, NOTE_LIST_QN)) as {
      rows: Array<{ ownerId: string }>;
    };
    expect(asA.rows).toHaveLength(2);
    expect(asA.rows.every((row) => row.ownerId === userA)).toBe(true);

    const asB = (await readAsMember(userB, NOTE_LIST_QN)) as {
      rows: Array<{ ownerId: string }>;
    };
    expect(asB.rows).toHaveLength(1);
    expect(asB.rows[0]?.ownerId).toBe(userB);
  });
});

// ── 2. whoami parity with a fresh interactive login ────────────────────────

describe("ctx.queryAsMember — resolved SessionUser matches an interactive login", () => {
  test("no sid, origin member-resolution, roles/claims equal to a fresh HTTP login", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("parity@example.com", "pw-long-enough-3");
    await addMembership(userId, TENANT_A);

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "parity@example.com",
      password: "pw-long-enough-3",
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { token: string };
    const loginPayload = await stack.jwt.verify(loginBody.token);

    const whoami = (await readAsMember(userId, WHOAMI_QN)) as {
      id: string;
      roles: readonly string[];
      claims: Record<string, unknown> | null;
      sid: string | null;
      origin: string | null;
    };

    expect(whoami.sid).toBeNull();
    expect(whoami.origin).toBe("member-resolution");
    expect(whoami.roles).toEqual(loginPayload.roles);
    expect(whoami.claims).toEqual(loginPayload.claims ?? null);
  });
});

// ── 3. AccessDenied — same generic error for every rejection reason ───────

describe("ctx.queryAsMember — AccessDenied, same generic error for every rejection cause", () => {
  const GENERIC_MESSAGE = "not permitted to read as this member";
  const GENERIC_DETAILS = { reason: "member_resolution_denied" };

  test("non-member userId", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("nonmember@example.com", "pw-long-enough-4");
    await addMembership(userId, TENANT_B);

    const err = await readAsMemberErr(userId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });

  test("restricted (blocked) principal", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("restricted@example.com", "pw-long-enough-5");
    await addMembership(userId, TENANT_A);
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: userId });

    const err = await readAsMemberErr(userId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });

  test("unknown principal (membership seeded, no user row) — background policy fails closed", async () => {
    await createTenant(TENANT_A);
    const unknownUserId = crypto.randomUUID();
    await addMembership(unknownUserId, TENANT_A);

    const err = await readAsMemberErr(unknownUserId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });

  test("tenant destroying", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("destroying@example.com", "pw-long-enough-6");
    await addMembership(userId, TENANT_A);
    await setTenantStatus(TENANT_A, "destroying");

    const err = await readAsMemberErr(userId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });

  // Background policy is stricter than interactive sign-in: destroyRequested
  // (cancel-window) is rejected too, unlike INTERACTIVE_SIGN_IN_POLICY.
  test("tenant destroyRequested — background policy is strict (interactive sign-in would allow this)", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("destroyrequested@example.com", "pw-long-enough-7");
    await addMembership(userId, TENANT_A);
    await setTenantStatus(TENANT_A, "destroyRequested");

    const err = await readAsMemberErr(userId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });

  test("would-be-SYSTEM principal (global SYSTEM_ROLE) — rejected the same generic way", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("wouldbesystem@example.com", "pw-long-enough-16");
    await addMembership(userId, TENANT_A);
    await updateRows(stack.db, userTable, { roles: [SYSTEM_ROLE] }, { id: userId });

    const err = await readAsMemberErr(userId, WHOAMI_QN);
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.details).toEqual(GENERIC_DETAILS);
  });
});

// ── 4. Cache — repeated calls for the same user resolve once ──────────────

describe("ctx.queryAsMember — per-context cache", () => {
  test("two calls for the same user increment the authClaims counter exactly once", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("cached@example.com", "pw-long-enough-8");
    await addMembership(userId, TENANT_A);

    authClaimsCalls.length = 0;
    const result = await stack.http.writeOk(
      "queryasmemberprobe:write:read-as-member-twice",
      { userId },
      admin,
    );
    expect(result).toBeDefined();
    expect(authClaimsCalls.filter((id) => id === userId)).toHaveLength(1);
  });

  test("two DIFFERENT users in one run resolve independently — authClaims counter +2", async () => {
    await createTenant(TENANT_A);
    const userA = await createUser("cacheA@example.com", "pw-long-enough-17");
    const userB = await createUser("cacheB@example.com", "pw-long-enough-18");
    await addMembership(userA, TENANT_A);
    await addMembership(userB, TENANT_A);

    authClaimsCalls.length = 0;
    const result = await stack.http.writeOk(
      "queryasmemberprobe:write:read-as-member-two-users",
      { userIdA: userA, userIdB: userB },
      admin,
    );
    expect(result).toBeDefined();
    expect(authClaimsCalls.filter((id) => id === userA || id === userB)).toHaveLength(2);
  });
});

// ── 5. Grant — the same escapeHatch/systemIdentitySwitch gate as SYSTEM queryAs ──

describe("ctx.queryAsMember — gated like a SYSTEM queryAs/writeAs", () => {
  test("handler without escapeHatch: denied", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("nograte@example.com", "pw-long-enough-9");
    await addMembership(userId, TENANT_A);

    const err = await stack.http.writeErr(
      "queryasmemberprobe:write:read-as-member-no-hatch",
      { userId, targetQn: WHOAMI_QN, payload: {} },
      admin,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("system_identity_switch_denied");
  });

  test("hook WITHOUT its own escapeHatch does not inherit the handler's grant: denied even though the handler has one", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("hooknohatch@example.com", "pw-long-enough-10");
    await addMembership(userId, TENANT_A);
    hookTargetUserId = userId;

    const err = await stack.http.writeErr(
      "queryasmemberprobe:write:hook-note-a:create",
      { label: "rolls back" },
      admin,
    );
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("system_identity_switch_denied");
    expect(hookNoHatchOutcomes).toEqual([{ threw: true }]);
  });

  test("hook WITH its own escapeHatch works even though the handler has none", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("hookwithhatch@example.com", "pw-long-enough-11");
    await addMembership(userId, TENANT_A);
    hookTargetUserId = userId;

    const result = await stack.http.writeOk<{ id: string }>(
      "queryasmemberprobe:write:hook-note-b:create",
      { label: "commits" },
      admin,
    );
    expect(result.id).toBeDefined();
    expect(hookWithHatchResults).toHaveLength(1);
    expect((hookWithHatchResults[0] as { id: string }).id).toBe(userId);
  });

  test("job: ctx.queryAsMember works ungated", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("jobmember@example.com", "pw-long-enough-12");
    await addMembership(userId, TENANT_A);

    // The job's tenant falls back to SYSTEM_TENANT_ID without one of
    // _tenantId/payload.tenantId — createMemberReaderFn fails closed on that.
    await stack.jobRunner?.dispatch("queryasmemberprobe:job:query-as-member-job", {
      userId,
      tenantId: TENANT_A,
    });

    await waitFor(() => {
      expect(jobQueryAsMemberResults).toHaveLength(1);
    });
    const jobResult = jobQueryAsMemberResults[0] as {
      id: string;
      origin: string;
      sid: string | null;
    };
    expect(jobResult.origin).toBe("member-resolution");
    expect(jobResult.id).toBe(userId);
    expect(jobResult.sid).toBeNull();
  });

  test("r.systemScope() feature handler: queryAsMember works without an escapeHatch", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("systemscope@example.com", "pw-long-enough-19");
    await addMembership(userId, TENANT_A);

    const result = await stack.http.writeOk<{ id: string }>(
      SYSTEM_SCOPE_READ_AS_MEMBER_QN,
      { userId },
      admin,
    );
    expect(result.id).toBe(userId);
  });
});

// ── 6. Read-only enforcement — a queried handler cannot write ─────────────

describe("ctx.queryAsMember — the resolved principal is read-only (no writeAsMember)", () => {
  test("target query handler calling ctx.write → denied with member_resolution_read_only", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("triesWrite@example.com", "pw-long-enough-13");
    await addMembership(userId, TENANT_A);

    const err = await readAsMemberErr(userId, TRIES_WRITE_QN);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
  });

  test("target query handler calling ctx.unsafeAppendEvent → denied with member_resolution_read_only", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("triesAppend@example.com", "pw-long-enough-14");
    await addMembership(userId, TENANT_A);

    const err = await readAsMemberErr(userId, TRIES_APPEND_EVENT_QN);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
  });

  test("target query handler calling ctx.jobRunner → denied with member_resolution_read_only", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("triesJob@example.com", "pw-long-enough-15");
    await addMembership(userId, TENANT_A);

    const err = await readAsMemberErr(userId, TRIES_JOB_RUNNER_QN);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
  });

  test("target query handler calling ctx.fetchForWriting(...).appendOne → denied with member_resolution_read_only", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("triesFetchForWriting@example.com", "pw-long-enough-20");
    await addMembership(userId, TENANT_A);

    const err = await readAsMemberErr(userId, TRIES_FETCH_FOR_WRITING_QN);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
  });

  test("stack.dispatcher.write called directly with a resolved-like user (origin set) → denied", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("directdispatch@example.com", "pw-long-enough-21");
    await addMembership(userId, TENANT_A);
    const resolvedLikeUser: SessionUser = {
      id: userId,
      tenantId: TENANT_A,
      roles: ["Admin"],
      origin: "member-resolution",
    };

    const result = await stack.dispatcher.write(
      "queryasmemberprobe:write:note:create",
      { ownerId: userId, body: "nope" },
      resolvedLikeUser,
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(errorReason(result.error.details)).toBe("member_resolution_read_only");
    }
  });
});
