// A test stack boots with row-level security on by default: every request, job and system-scoped handler
// below runs as the non-bypass application role, over real HTTP and a real JobRunner.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { table, text, uuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import { rowLevelSecurityModeOf } from "../../db/row-level-security-connection.ts";
import { defineFeature, defineWriteHandler } from "../../engine/index.ts";
import { stepsPipeline } from "../../engine/pipeline.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const itemsTable = table("fw4_rls_stack_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const admin = TestUsers.admin;
const otherAdmin = TestUsers.otherTenant;
const CROSS_TENANT_REASON = "row-level-security stack test reads the items of every tenant";

const labelsOf = (rows: readonly { label: string }[]): string[] =>
  rows.map((row) => row.label).sort();

const tenantFeature = defineFeature("rlsstack", (r) => {
  r.requires.projection("fw4_rls_stack_items");

  r.writeHandler(
    defineWriteHandler({
      name: "add",
      schema: z.object({ label: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        await ctx.db.insertOne(itemsTable, { label: event.payload.label });
        return { isSuccess: true as const, data: { ok: true } };
      },
    }),
  );

  r.queryHandler({
    name: "list",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async (_query, ctx) => ({ labels: labelsOf(await selectMany(ctx.db, itemsTable)) }),
  });

  const listAllSchema = z.object({});
  r.writeHandler(
    defineWriteHandler({
      name: "list-all-tenants",
      schema: listAllSchema,
      access: { roles: ["Admin"] },
      escapeHatch: { reason: CROSS_TENANT_REASON },
      perform: stepsPipeline<z.infer<typeof listAllSchema>, { labels: string[] }>(({ r: step }) => [
        step.step.read.findMany("items", {
          table: itemsTable,
          unsafeAllTenants: { reason: CROSS_TENANT_REASON },
        }),
        step.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { labels: labelsOf(steps["items"] as readonly { label: string }[]) },
        })),
      ]),
    }),
  );

  r.job("copy-count", { trigger: { manual: true } }, async (_payload, ctx) => {
    const seen = await selectMany<{ label: string }>(ctx.db, itemsTable);
    await ctx.db.insertOne(itemsTable, { label: `job-saw-${seen.length}` });
  });
});

const systemFeature = defineFeature("rlssystem", (r) => {
  r.systemScope();

  r.writeHandler(
    defineWriteHandler({
      name: "add-for-tenant",
      schema: z.object({ tenantId: z.uuid(), label: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const db = ctx.systemDb.acknowledgeCrossTenant(CROSS_TENANT_REASON);
        await insertOne(db, itemsTable, {
          tenantId: event.payload.tenantId,
          label: event.payload.label,
        });
        return { isSuccess: true as const, data: { ok: true } };
      },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [tenantFeature, systemFeature],
    jobs: { consumerLane: "worker" },
  });
  await unsafePushTables(stack.unscopedDb, { fw4_rls_stack_items: itemsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("test stack with row-level security on", () => {
  test("services run on the enforced pool, stack.db is system scoped", async () => {
    expect(rowLevelSecurityModeOf(stack.unscopedDb)).toBe("on");
    await insertOne(stack.db, itemsTable, { tenantId: admin.tenantId, label: "seeded-own" });
    await insertOne(stack.db, itemsTable, { tenantId: otherAdmin.tenantId, label: "seeded-other" });
    expect(labelsOf(await selectMany(stack.db, itemsTable))).toEqual([
      "seeded-other",
      "seeded-own",
    ]);
    expect(await selectMany(stack.unscopedDb, itemsTable)).toEqual([]);
  });

  test("an own-tenant write and read go through, the other tenant sees nothing of it", async () => {
    await stack.http.writeOk("rlsstack:write:add", { label: "via-http" }, admin);
    const own = await stack.http.queryOk<{ labels: string[] }>("rlsstack:query:list", {}, admin);
    expect(own.labels).toEqual(["seeded-own", "via-http"]);
    const other = await stack.http.queryOk<{ labels: string[] }>(
      "rlsstack:query:list",
      {},
      otherAdmin,
    );
    expect(other.labels).toEqual(["seeded-other"]);
  });

  test("a declared unsafeAllTenants read step sees the rows of a foreign tenant", async () => {
    const data = await stack.http.writeOk<{ labels: string[] }>(
      "rlsstack:write:list-all-tenants",
      {},
      admin,
    );
    expect(data.labels).toEqual(["seeded-other", "seeded-own", "via-http"]);
  });

  test("an r.systemScope() handler writes a row for another tenant through systemDb", async () => {
    await stack.http.writeOk(
      "rlssystem:write:add-for-tenant",
      { tenantId: otherAdmin.tenantId, label: "written-by-system" },
      admin,
    );
    const other = await stack.http.queryOk<{ labels: string[] }>(
      "rlsstack:query:list",
      {},
      otherAdmin,
    );
    expect(other.labels).toContain("written-by-system");
    const own = await stack.http.queryOk<{ labels: string[] }>("rlsstack:query:list", {}, admin);
    expect(own.labels).not.toContain("written-by-system");
  });

  test("a job reads and writes the rows of its own tenant only", async () => {
    await stack.jobRunner?.dispatch("rlsstack:job:copy-count", { tenantId: admin.tenantId });
    await stack.drainJobs();
    const own = await stack.http.queryOk<{ labels: string[] }>("rlsstack:query:list", {}, admin);
    expect(own.labels).toContain("job-saw-2");
    const other = await stack.http.queryOk<{ labels: string[] }>(
      "rlsstack:query:list",
      {},
      otherAdmin,
    );
    expect(other.labels.some((label) => label.startsWith("job-saw-"))).toBe(false);
  });
});
