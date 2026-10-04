// EventStoreExecutor writes made through a dispatcher- or job-runner-built
// TenantDb run the registry's custom projections themselves: a hook or job that
// creates a second aggregate no longer leaves its read model stale, and the
// dispatcher's own projection pass does not apply the same event twice.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.js";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { insertOne, selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  HookPhases,
} from "../../engine/index.js";
import { createSystemUser } from "../../engine/system-user.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";

const orderEntity = createEntity({
  table: "read_exproj_orders",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const auditEntity = createEntity({
  table: "read_exproj_audits",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const auditTable = buildEntityTable("audit", auditEntity);

const auditLogTable = pgTable("read_exproj_audit_log", {
  auditId: pgUuid("audit_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  label: pgText("label").notNull(),
});

function isTenantDb(db: unknown): db is TenantDb {
  return typeof db === "object" && db !== null && "insertOne" in db;
}

const admin = TestUsers.admin;
const FAILING_LABEL = "projection-explodes";
const projectionCalls: string[] = [];

const exprojFeature = defineFeature("exproj", (r) => {
  r.entity("order", orderEntity);
  r.entity("audit", auditEntity);

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

  r.writeHandler(defineEntityCreateHandler("order", orderEntity, { access: { roles: ["Admin"] } }));
  r.writeHandler(defineEntityCreateHandler("audit", auditEntity, { access: { roles: ["Admin"] } }));

  const auditExecutor = createEventStoreExecutor(auditTable, auditEntity, { entityName: "audit" });

  // The second aggregate is written straight through the executor, as apps do.
  r.hook(
    "postSave",
    { allOf: "order" },
    async (result, ctx) => {
      if (!isTenantDb(ctx.db)) throw new Error("hook ctx.db is not a TenantDb");
      const outcome = await auditExecutor.create(
        { label: String(result.data["title"]) },
        createSystemUser(admin.tenantId),
        ctx.db,
      );
      if (!outcome.isSuccess) throw new Error("hook audit write failed");
    },
    { phase: HookPhases.inTransaction },
  );

  r.job("make-audit", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const label = payload["label"];
    if (typeof label !== "string") throw new Error("make-audit needs a label");
    const outcome = await auditExecutor.create({ label }, ctx.systemUser, ctx.db);
    if (!outcome.isSuccess) throw new Error("job audit write failed");
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [exprojFeature], jobs: { consumerLane: "worker" } });
  await unsafeCreateEntityTable(stack.db, orderEntity, "order");
  await unsafeCreateEntityTable(stack.db, auditEntity, "audit");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  projectionCalls.length = 0;
  await resetEventStore(stack, [
    "read_exproj_orders",
    "read_exproj_audits",
    "read_exproj_audit_log",
  ]);
});

async function logRows(): Promise<readonly { label: string }[]> {
  return selectMany(stack.db, auditLogTable);
}

describe("executor writes run custom projections", () => {
  test("a hook that creates a second aggregate through the executor updates its projection", async () => {
    await stack.http.writeOk("exproj:write:order:create", { title: "order-one" }, admin);

    const rows = await logRows();
    expect(rows.map((row) => row.label)).toEqual(["order-one"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("a plain CRUD write over HTTP projects exactly once", async () => {
    await stack.http.writeOk("exproj:write:audit:create", { label: "direct" }, admin);

    expect((await logRows()).map((row) => row.label)).toEqual(["direct"]);
    expect(projectionCalls).toHaveLength(1);
  });

  test("a throwing projection fails the hook write: neither aggregate is persisted", async () => {
    const res = await stack.http.write(
      "exproj:write:order:create",
      { title: FAILING_LABEL },
      admin,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await selectMany(stack.db, buildEntityTable("order", orderEntity))).toHaveLength(0);
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
});
