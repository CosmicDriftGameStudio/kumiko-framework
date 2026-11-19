// EventStoreExecutor writes made through a dispatcher- or job-runner-built
// TenantDb run the registry's custom projections themselves: a hook or job that
// creates a second aggregate no longer leaves its read model stale, and the
// dispatcher's own projection pass does not apply the same event twice.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import * as z from "zod";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { insertOne, selectMany, transaction } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  HookPhases,
} from "../../engine/index.ts";
import { createSystemUser } from "../../engine/system-user.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const orderEntity = createEntity({
  name: "order",
  table: "read_exproj_orders",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const memoEntity = createEntity({
  name: "memo",
  table: "read_exproj_memos",
  fields: { text: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const auditEntity = createEntity({
  name: "audit",
  table: "read_exproj_audits",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const auditTable = buildEntityTable(auditEntity);

const auditExecutor = createEventStoreExecutor(auditTable, auditEntity, { entityName: "audit" });

const auditLogTable = pgTable("read_exproj_audit_log", {
  auditId: pgUuid("audit_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  label: pgText("label").notNull(),
});

const mspMarksTable = pgTable("read_exproj_msp_marks", {
  id: pgUuid("id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
});

function isTenantDb(db: unknown): db is TenantDb {
  return typeof db === "object" && db !== null && "insertOne" in db;
}

const admin = TestUsers.admin;
const FAILING_LABEL = "projection-explodes";
const projectionCalls: string[] = [];

const exprojFeature = defineFeature("exproj", (r) => {
  r.entity(orderEntity);
  r.entity(auditEntity);
  r.entity(memoEntity);

  r.projection({
    name: "audit-log",
    source: "audit",
    table: auditLogTable,
    apply: {
      "audit.created": async (event, tx) => {
        const payload = event.payload as { label: string };
        projectionCalls.push(event.aggregateId);
        if (payload.label === FAILING_LABEL) throw new Error("projection failed on purpose");
        await insertOne(tx, auditLogTable, {
          auditId: event.aggregateId,
          tenantId: event.tenantId,
          label: payload.label,
        });
      },
    },
  });

  const markRaised = r.defineEvent("mark-raised", z.object({}), { piiFields: "none" });

  r.multiStreamProjection({
    name: "exproj-msp",
    table: mspMarksTable,
    apply: {
      [markRaised.name]: async (event, tx) => {
        const tenantDb = createTenantDb({
          db: tx,
          tenantId: event.tenantId,
          mode: "system",
          reason: "test: msp writes a second aggregate through the executor",
        });
        const outcome = await auditExecutor.create(
          { label: "from-msp" },
          createSystemUser(event.tenantId),
          tenantDb,
        );
        if (!outcome.isSuccess) throw new Error("msp audit write failed");
      },
    },
  });

  r.writeHandler({
    name: "mark:raise",
    schema: z.object({}),
    handler: async (_event, ctx) => {
      const id = crypto.randomUUID();
      await ctx.events.unsafeAppend({
        aggregateId: id,
        blindAppendReason: "test fixture appends an independent fact; ordering is not under test",
        aggregateType: "audit",
        type: markRaised.name,
        payload: {},
      });
      return { isSuccess: true, data: { id } };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler(defineEntityCreateHandler("order", orderEntity, { access: { roles: ["Admin"] } }));
  r.writeHandler(defineEntityCreateHandler("audit", auditEntity, { access: { roles: ["Admin"] } }));
  r.writeHandler(defineEntityCreateHandler("memo", memoEntity, { access: { roles: ["Admin"] } }));

  // The second aggregate is written straight through the executor, as apps do.
  r.hook({
    type: "postSave",
    target: { allOf: "order" },
    handler: async (result, ctx) => {
      if (!isTenantDb(ctx.db)) throw new Error("hook ctx.db is not a TenantDb");
      const outcome = await auditExecutor.create(
        { label: String(result.data["title"]) },
        createSystemUser(admin.tenantId),
        ctx.db,
      );
      if (!outcome.isSuccess) throw new Error("hook audit write failed");
    },
    phase: HookPhases.inTransaction,
  });

  r.hook({
    type: "postSave",
    target: { allOf: "memo" },
    handler: async (result, ctx) => {
      if (!isTenantDb(ctx.db)) throw new Error("hook ctx.db is not a TenantDb");
      const ownTenantDb = createTenantDb({
        db: ctx.db.unsafeRawAllTenants(),
        tenantId: admin.tenantId,
      });
      const outcome = await auditExecutor.create(
        { label: String(result.data["text"]) },
        createSystemUser(admin.tenantId),
        ownTenantDb,
      );
      if (!outcome.isSuccess) throw new Error("hook audit write via unsafeRaw failed");
    },
    phase: HookPhases.inTransaction,
    escapeHatch: {
      reason: "test: TenantDb rebuilt from unsafeRaw",
      grants: ["systemIdentity", "unsafeRaw"],
    },
  });

  // A job dispatched without a write origin builds its TenantDb without a personal-data gate;
  // a TenantDb rebuilt from its unsafeRaw() grant must still run the custom projections.
  r.job({
    name: "make-audit-via-unsafe-raw",
    trigger: { manual: true },
    retries: 0,
    escapeHatch: {
      reason: "test: TenantDb rebuilt from unsafeRaw inside a job",
      grants: ["unsafeRaw"],
    },
    handler: async (payload, ctx) => {
      const label = payload["label"];
      if (typeof label !== "string") throw new Error("make-audit-via-unsafe-raw needs a label");
      const ownTenantDb = createTenantDb({
        db: ctx.db.unsafeRawAllTenants(),
        tenantId: ctx.systemUser.tenantId,
      });
      const outcome = await auditExecutor.create({ label }, ctx.systemUser, ownTenantDb);
      if (!outcome.isSuccess) throw new Error("job audit write via unsafeRaw failed");
    },
  });

  r.job({
    name: "make-audit",
    trigger: { manual: true },
    retries: 0,
    handler: async (payload, ctx) => {
      const label = payload["label"];
      if (typeof label !== "string") throw new Error("make-audit needs a label");
      const outcome = await auditExecutor.create({ label }, ctx.systemUser, ctx.db);
      if (!outcome.isSuccess) throw new Error("job audit write failed");
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [exprojFeature], jobs: { consumerLane: "worker" } });
  await unsafeCreateEntityTable(stack.db, orderEntity, "order");
  await unsafeCreateEntityTable(stack.db, auditEntity, "audit");
  await unsafeCreateEntityTable(stack.db, memoEntity, "memo");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  projectionCalls.length = 0;
  await resetEventStore(stack, [
    "read_exproj_orders",
    "read_exproj_audits",
    "read_exproj_memos",
    "read_exproj_audit_log",
    "read_exproj_msp_marks",
  ]);
});

async function logRows(): Promise<readonly { label: string }[]> {
  return selectMany<{ label: string }>(stack.db, auditLogTable);
}

describe("executor writes run custom projections", () => {
  test("a hook that creates a second aggregate through the executor updates its projection", async () => {
    await stack.http.writeOk("exproj:write:order:create", { title: "order-one" }, admin);

    const rows = await logRows();
    expect(rows.map((row) => row.label)).toEqual(["order-one"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("a TenantDb a hook rebuilds from ctx.db.unsafeRaw() projects exactly once", async () => {
    await stack.http.writeOk("exproj:write:memo:create", { text: "via-unsafe-raw" }, admin);

    expect((await logRows()).map((row) => row.label)).toEqual(["via-unsafe-raw"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("a plain CRUD write over HTTP projects exactly once", async () => {
    await stack.http.writeOk("exproj:write:audit:create", { label: "direct" }, admin);

    expect((await logRows()).map((row) => row.label)).toEqual(["direct"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("an executor write on a TenantDb built over a raw transaction projects exactly once", async () => {
    await transaction(stack.db, async (tx) => {
      const tenantDb = createTenantDb({ db: tx, tenantId: admin.tenantId });
      const outcome = await auditExecutor.create(
        { label: "raw-tx" },
        createSystemUser(admin.tenantId),
        tenantDb,
      );
      expect(outcome.isSuccess).toBe(true);
    });

    expect((await logRows()).map((row) => row.label)).toEqual(["raw-tx"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("a multi-stream projection apply that writes through the executor projects", async () => {
    await stack.http.writeOk("exproj:write:mark:raise", {}, admin);
    await stack.eventDispatcher?.runOnce();

    expect((await logRows()).map((row) => row.label)).toContain("from-msp");
    expect(projectionCalls).toHaveLength(1);
  });

  test("a throwing projection fails the hook write: neither aggregate is persisted", async () => {
    const res = await stack.http.write(
      "exproj:write:order:create",
      { title: FAILING_LABEL },
      admin,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await selectMany(stack.db, buildEntityTable(orderEntity))).toHaveLength(0);
    expect(await selectMany(stack.db, auditTable)).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);
  });

  test("a job writing through the executor projects too", async () => {
    await stack.jobRunner?.dispatch("exproj:job:make-audit", {
      label: "from-job",
      tenantId: admin.tenantId,
    });

    await waitFor(async () => {
      expect((await logRows()).map((row) => row.label)).toEqual(["from-job"]);
    });
    expect(projectionCalls).toHaveLength(1);
  });

  test("a job writing through a TenantDb rebuilt from ctx.db.unsafeRaw() projects exactly once", async () => {
    await stack.jobRunner?.dispatch("exproj:job:make-audit-via-unsafe-raw", {
      label: "from-job-unsafe-raw",
      tenantId: admin.tenantId,
    });

    await waitFor(async () => {
      expect((await logRows()).map((row) => row.label)).toEqual(["from-job-unsafe-raw"]);
    });
    expect(projectionCalls).toHaveLength(1);
  });
});
