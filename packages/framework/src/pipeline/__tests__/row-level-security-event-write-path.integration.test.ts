// The event write path keeps the caller's tenant scope: a dispatched command in tenant scope cannot land a
// projection row in another tenant (Postgres rejects it), while an explicit system scope can.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const admin = TestUsers.admin;
const other = TestUsers.otherTenant;

const noteEntity = createEntity({
  table: "read_wp_notes",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const { table: noteTable, executor: noteExecutor } = createEntityExecutor("wp-note", noteEntity);

const globalEntity = createEntity({
  table: "read_wp_globals",
  tenancy: "global",
  systemStream: true,
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const { table: globalTable, executor: globalExecutor } = createEntityExecutor(
  "wp-global",
  globalEntity,
);

const crossTenantSchema = z.object({ label: z.string(), tenantId: z.uuid() });

const feature = defineFeature("wp", (r) => {
  r.entity({ name: "wp-note", ...noteEntity });
  r.entity({ name: "wp-global", ...globalEntity });
  r.writeHandler(
    defineWriteHandler({
      name: "create-global",
      schema: z.object({ label: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const result = await globalExecutor.create(
          { label: event.payload.label },
          ctx.user,
          ctx.db,
        );
        return result.isSuccess
          ? { isSuccess: true as const, data: { id: result.data.id } }
          : result;
      },
    }),
  );
  r.writeHandler(
    defineEntityCreateHandler("wp-note", noteEntity, { access: { roles: ["Admin"] } }),
  );

  // The row's tenant comes from payload.tenantId, the stream stays in the caller's tenant.
  r.writeHandler(
    defineWriteHandler({
      name: "create-for-tenant",
      schema: crossTenantSchema,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const result = await noteExecutor.create(
          { label: event.payload.label, tenantId: event.payload.tenantId },
          ctx.user,
          ctx.db,
        );
        return result.isSuccess
          ? { isSuccess: true as const, data: { id: result.data.id } }
          : result;
      },
    }),
  );
});

const systemFeature = defineFeature("wpsys", (r) => {
  r.systemScope();
  r.writeHandler(
    defineWriteHandler({
      name: "create-for-tenant",
      schema: crossTenantSchema,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const result = await noteExecutor.create(
          { label: event.payload.label, tenantId: event.payload.tenantId },
          ctx.user,
          ctx.systemDb.acknowledgeCrossTenant(
            "test seeds a note for another tenant like seedTenantMembership does",
          ),
        );
        return result.isSuccess
          ? { isSuccess: true as const, data: { id: result.data.id } }
          : result;
      },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature, systemFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

const labelsIn = async (tenantId: string): Promise<string[]> =>
  (await selectMany<{ label: string; tenantId: string }>(stack.db, noteTable))
    .filter((row) => row.tenantId === tenantId)
    .map((row) => row.label);

describe("event write path under row-level security", () => {
  test("a create in the caller's tenant lands in that tenant", async () => {
    await stack.http.writeOk("wp:write:wp-note:create", { label: "own" }, admin);
    expect(await labelsIn(admin.tenantId)).toContain("own");
  });

  test("a projection write for another tenant under a tenant scope is rejected by Postgres", async () => {
    const error = await stack.http.writeErr(
      "wp:write:create-for-tenant",
      { label: "leak", tenantId: other.tenantId },
      admin,
    );
    expect(error.code).toBe("internal_error");
    expect(JSON.stringify(error.details)).toMatch(/row-level security/);
    expect(await labelsIn(other.tenantId)).not.toContain("leak");
  });

  test("the same write under an explicit system scope succeeds", async () => {
    await stack.http.writeOk(
      "wpsys:write:create-for-tenant",
      { label: "seeded", tenantId: other.tenantId },
      admin,
    );
    expect(await labelsIn(other.tenantId)).toContain("seeded");
  });

  test("a global entity write under a tenant scope projects as system", async () => {
    await stack.http.writeOk("wp:write:create-global", { label: "shared" }, admin);
    const rows = await selectMany<{ label: string }>(stack.db, globalTable);
    expect(rows.map((row) => row.label)).toContain("shared");
  });

  test("a rebuild still materializes every tenant's rows", async () => {
    await rebuildProjection("wp:projection:wp-note-entity", {
      db: stack.unscopedDb,
      registry: stack.registry,
    });
    expect(await labelsIn(admin.tenantId)).toContain("own");
    expect(await labelsIn(other.tenantId)).toContain("seeded");
  });
});
