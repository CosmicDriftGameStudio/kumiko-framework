// An r.systemScope() query reached via ctx.dispatch.queryAsMember keeps a ctx.systemDb, but only
// the READ ONLY view: reads work, no raw runner, no outside-transaction door, no writes.
// Real HTTP via setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { deriveEntityTableMeta, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineQueryHandler,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature, TenantHandlers, tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../../tenant-lifecycle/lifecycle-gate.ts";
import {
  createUserFeature,
  UserHandlers,
  UserQueries,
  userEntity,
  userTable,
} from "../../user/index.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthHandlers } from "../web/constants.ts";

const REASON = "test: system-scope probe";

// Unmanaged store: the runtime ES-write lock would deny a direct write on an event-fed
// table before the READ ONLY transaction under test is reached.
const guardEntity = createEntity({
  table: "store_qamsys_guard",
  fields: {
    body: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: { read: { Admin: "all" }, write: { Admin: "all" } },
});
const guardTable = deriveEntityTableMeta("guard", guardEntity, { source: "unmanaged" });

const READ_AS_MEMBER_QN = "qamsys:write:read-as-member";
const READS_USER_ROWS_QN = "qamsys:query:reads-user-rows";
const TRIES_UNSAFE_RAW_QN = "qamsys:query:tries-unsafe-raw";
const TRIES_OUTSIDE_TX_QN = "qamsys:query:tries-outside-transaction";
const TRIES_WRITE_QN = "qamsys:query:tries-write";

const systemFeature = defineFeature("qamsys", (r) => {
  r.systemScope();

  r.writeHandler(
    defineWriteHandler({
      name: "read-as-member",
      schema: z.object({ userId: z.string(), targetQn: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const data = await ctx.dispatch.queryAsMember(
          event.payload.userId,
          event.payload.targetQn,
          {},
        );
        return { isSuccess: true as const, data };
      },
    }),
  );

  r.queryHandler(
    defineQueryHandler({
      name: "reads-user-rows",
      schema: z.object({}),
      access: { roles: ["Admin", "User"] },
      handler: async (_query, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const db = ctx.systemDb.acknowledgeCrossTenant(REASON);
        const rows = await selectMany<{ id: string }>(db, userTable);
        return { ids: rows.map((row) => row.id) };
      },
    }),
  );

  r.queryHandler(
    defineQueryHandler({
      name: "tries-unsafe-raw",
      schema: z.object({}),
      access: { roles: ["Admin", "User"] },
      handler: async (_query, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        ctx.systemDb.unsafeRaw(REASON);
        return { ok: true };
      },
    }),
  );

  r.queryHandler(
    defineQueryHandler({
      name: "tries-outside-transaction",
      schema: z.object({}),
      access: { roles: ["Admin", "User"] },
      handler: async (_query, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        try {
          ctx.systemDb.outsideTransaction.acknowledgeCrossTenant(REASON);
          return { message: null };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  );

  r.queryHandler(
    defineQueryHandler({
      name: "tries-write",
      schema: z.object({}),
      access: { roles: ["Admin", "User"] },
      handler: async (_query, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const db = ctx.systemDb.acknowledgeCrossTenant(REASON);
        await insertOne(db, guardTable, { tenantId: db.tenantId, body: "tampered" });
        return { ok: true };
      },
    }),
  );
});

let stack: TestStack;

const TENANT_A: TenantId = testTenantId(1);
const admin: SessionUser = { ...TestUsers.admin, tenantId: TENANT_A };

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createAuthEmailPasswordFeature(),
      systemFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, guardEntity, "guard");
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
    guardTable,
  ]);
  await seedRow(stack.db, guardTable, { tenantId: TENANT_A, body: "untouched" });
});

async function createMemberUser(email: string): Promise<string> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: TENANT_A, key: `t-${TENANT_A.slice(-8)}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email,
      passwordHash: await hashPassword("pw-long-enough-12"),
      displayName: email.split("@")[0] ?? "user",
    },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT_A, roles: ["User"] });
  return created.id;
}

function readAsMember(userId: string, targetQn: string) {
  return stack.http.writeOk<unknown>(READ_AS_MEMBER_QN, { userId, targetQn }, admin);
}

function readAsMemberErr(userId: string, targetQn: string) {
  return stack.http.writeErr(READ_AS_MEMBER_QN, { userId, targetQn }, admin);
}

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

describe("ctx.dispatch.queryAsMember — r.systemScope() target query", () => {
  test("a) reads a row through ctx.systemDb.acknowledgeCrossTenant", async () => {
    const userId = await createMemberUser("sysread@example.com");

    const result = await readAsMember(userId, READS_USER_ROWS_QN);

    expect(result).toEqual({ ids: [userId] });
  });

  test("b) ctx.systemDb.unsafeRaw is denied with member_resolution_read_only", async () => {
    const userId = await createMemberUser("sysraw@example.com");

    const err = await readAsMemberErr(userId, TRIES_UNSAFE_RAW_QN);

    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
  });

  test("c) ctx.systemDb.outsideTransaction has no source and throws", async () => {
    const userId = await createMemberUser("sysoutside@example.com");

    const result = await readAsMember(userId, TRIES_OUTSIDE_TX_QN);

    expect(result).toEqual({
      message:
        "systemScope() outsideTransaction check failed: no outside-transaction database source is configured for this dispatch.",
    });
  });

  test("d) a write through acknowledgeCrossTenant fails and leaves the table unchanged", async () => {
    const userId = await createMemberUser("syswrite@example.com");

    const err = await readAsMemberErr(userId, TRIES_WRITE_QN);

    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("member_resolution_read_only");
    const rows = await selectMany<{ body: string }>(stack.db, guardTable);
    expect(rows.map((row) => row.body)).toEqual(["untouched"]);
  });

  test("e) the bundled user:me returns the member's own row", async () => {
    const userId = await createMemberUser("sysme@example.com");

    const result = await readAsMember(userId, UserQueries.me);

    expect(result).toMatchObject({ id: userId, email: "sysme@example.com" });
  });
});
