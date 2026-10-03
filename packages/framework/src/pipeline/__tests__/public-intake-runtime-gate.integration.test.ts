// Every anonymous handler here keeps personal-data keys out of its own input schema,
// so the static boot check passes and only the runtime gate can stop the write.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import type { DbRunner } from "../../db/connection.js";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import type { SchemaTable } from "../../db/index.js";
import { asRawClient, runInSavepoint, selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.js";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "../../engine/index.js";
import { SYSTEM_ROLE } from "../../engine/system-user.js";
import type { TenantId } from "../../engine/types/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { seedRows } from "../../testing/index.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const RATE_LIMIT = { per: "ip", limit: 1000, windowSeconds: 60 } as const;

// --- Feature B: owns the PII-carrying entity ---

const contactEntity = createEntity({
  table: "intake_contacts",
  fields: {
    email: createTextField({ personal: "self", find: "none", default: "" }),
    note: createTextField({ personal: false, reason: "test_fixture", default: "" }),
  },
});
const contactTable = buildEntityTable("contact", contactEntity);

// No `table:` override: the gate must resolve the default, entity-name-derived table.
const leadEntity = createEntity({
  fields: {
    phone: createTextField({ personal: "self", find: "none", default: "" }),
  },
});
const leadTable = buildEntityTable("intakeLead", leadEntity);

// tenancy "global": rows carry SYSTEM_TENANT_ID and are written through db.global().
const globalContactEntity = createEntity({
  table: "intake_global_contacts",
  tenancy: "global",
  fields: {
    email: createTextField({ personal: "self", find: "none", default: "" }),
  },
});
const globalContactTable = buildEntityTable("globalContact", globalContactEntity);

const featureB = defineFeature("intakeb", (r) => {
  r.entity("contact", contactEntity);
  r.entity("globalContact", globalContactEntity);
  r.entity("intakeLead", leadEntity);

  r.writeHandler(
    "create-lead",
    z.object({ phone: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(leadTable, leadEntity, { entityName: "intakeLead" });
      return crud.create({ phone: event.payload.phone }, event.user, ctx.db);
    },
    { access: { roles: [SYSTEM_ROLE] } },
  );

  r.writeHandler(
    "create",
    z.object({ email: z.string(), note: z.string().optional() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(contactTable, contactEntity, { entityName: "contact" });
      return crud.create(
        { email: event.payload.email, note: event.payload.note ?? "" },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: [SYSTEM_ROLE] } },
  );
});

// --- Feature A: anonymous entry points that try to leak B's PII by every route ---

const probeEntity = createEntity({
  table: "intake_probes",
  fields: {
    note: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const probeTable = buildEntityTable("probe", probeEntity);

const featureA = defineFeature("intakea", (r) => {
  r.entity("probe", probeEntity);

  r.writeHandler(
    "direct-insert-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      // @cast-boundary test-fixture — proving the RUNTIME gate stops this
      // write, not the compile-time ExecutorOnly brand on contactTable.
      await ctx.db.insertOne(contactTable as unknown as SchemaTable, {
        email: "leak-direct@example.com",
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "direct-insert-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      // @cast-boundary test-fixture — see direct-insert-no-declare above.
      await ctx.db.insertOne(contactTable as unknown as SchemaTable, {
        email: "leak-direct-declared@example.com",
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "writeas-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "intakeb:write:create", {
        email: "leak-writeas@example.com",
        note: event.payload.note,
      }),
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: "test: cross-identity detour to prove the gate survives writeAs" },
    },
  );

  r.writeHandler(
    "writeas-declare",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "intakeb:write:create", {
        email: "leak-writeas-declared@example.com",
        note: event.payload.note,
      }),
    {
      access: { roles: ["anonymous"], personalData: "public-intake" },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: "test: cross-identity detour to prove the gate survives writeAs" },
    },
  );

  // The postSave hook only fires for handlers whose result is a genuine
  // SaveContext (createEventStoreExecutor's crud.create), so these write to
  // a harmless non-PII probe entity purely to trigger the hook.
  r.writeHandler(
    "hook-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(probeTable, probeEntity, { entityName: "probe" });
      return crud.create({ note: event.payload.note }, event.user, ctx.db);
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "hook-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(probeTable, probeEntity, { entityName: "probe" });
      return crud.create({ note: event.payload.note }, event.user, ctx.db);
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );
  r.hook("postSave", "hook-no-declare", async (_result, ctx) => {
    // @cast-boundary test-fixture — postSave hooks receive HandlerContext as
    // AppContext, whose `db` is typed as the DbConnection|TenantDb union
    // (fail-closed at the outer boundary); at runtime it's always the
    // TenantDb built for this write. See direct-insert-no-declare above.
    await (ctx.db as TenantDb).insertOne(contactTable as unknown as SchemaTable, {
      email: "leak-hook@example.com",
      note: "from-afterCommit-hook",
    });
  });
  r.hook("postSave", "hook-declare", async (_result, ctx) => {
    // @cast-boundary test-fixture — see hook-no-declare above.
    await (ctx.db as TenantDb).insertOne(contactTable as unknown as SchemaTable, {
      email: "leak-hook-declared@example.com",
      note: "from-afterCommit-hook",
    });
  });

  r.queryHandler(
    "detour-query",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      ctx.write("intakeb:write:create", {
        email: "leak-queryas@example.com",
        note: event.payload.note,
      }),
    { access: { roles: [SYSTEM_ROLE] } },
  );

  r.writeHandler(
    "queryas-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      // Detour: anonymous root -> ctx.queryAs(SYSTEM) -> that query handler's
      // own ctx.write. The origin travels with the root call, not the
      // identity-switched SYSTEM user, so this must still be blocked.
      ctx.queryAs(createSystemUser(event.user.tenantId), "intakea:query:detour-query", {
        note: event.payload.note,
      }) as ReturnType<typeof ctx.write>,
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: {
        reason: "test: queryAs detour to prove the gate survives nested query->write",
      },
    },
  );
  r.writeHandler(
    "queryas-declare",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      ctx.queryAs(createSystemUser(event.user.tenantId), "intakea:query:detour-query", {
        note: event.payload.note,
      }) as ReturnType<typeof ctx.write>,
    {
      access: { roles: ["anonymous"], personalData: "public-intake" },
      rateLimit: RATE_LIMIT,
      escapeHatch: {
        reason: "test: queryAs detour to prove the gate survives nested query->write",
      },
    },
  );

  r.writeHandler(
    "default-table-insert-no-declare",
    z.object({ note: z.string() }),
    async (_event, ctx) => {
      // @cast-boundary test-fixture — see direct-insert-no-declare above.
      await ctx.db.insertOne(leadTable as unknown as SchemaTable, { phone: "+49 30 1234" });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "default-table-writeas-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) =>
      ctx.writeAs(createSystemUser(event.user.tenantId), "intakeb:write:create-lead", {
        phone: "+49 30 5678",
      }),
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: "test: cross-identity detour to prove the gate survives writeAs" },
    },
  );

  for (const declared of [false, true]) {
    const suffix = declared ? "declare" : "no-declare";
    const access = declared
      ? ({ roles: ["anonymous"], personalData: "public-intake" } as const)
      : ({ roles: ["anonymous"] } as const);

    r.writeHandler(
      `update-many-${suffix}`,
      z.object({ id: z.uuid() }),
      async (event, ctx) => {
        // @cast-boundary test-fixture — see direct-insert-no-declare above.
        await ctx.db.updateMany(
          contactTable as unknown as SchemaTable,
          { email: "overwritten@example.com" },
          { id: event.payload.id },
        );
        return { isSuccess: true as const, data: { ok: true as const } };
      },
      { access, rateLimit: RATE_LIMIT },
    );

    r.writeHandler(
      `executor-update-${suffix}`,
      z.object({ id: z.uuid() }),
      async (event, ctx) => {
        const crud = createEventStoreExecutor(contactTable, contactEntity, {
          entityName: "contact",
        });
        return crud.update(
          { id: event.payload.id, changes: { email: "overwritten@example.com" } },
          event.user,
          ctx.db,
          { skipOptimisticLock: true },
        );
      },
      { access, rateLimit: RATE_LIMIT },
    );
  }

  const GLOBAL_WRITE_REASON =
    "test: db.global() write to prove the personal-data gate applies there";
  for (const declared of [false, true]) {
    const suffix = declared ? "declare" : "no-declare";
    const access = declared
      ? ({ roles: ["anonymous"], personalData: "public-intake" } as const)
      : ({ roles: ["anonymous"] } as const);

    r.writeHandler(
      `global-insert-${suffix}`,
      z.object({ note: z.string() }),
      async (_event, ctx) => {
        // @cast-boundary test-fixture — see direct-insert-no-declare above.
        await ctx.db
          .global(globalContactTable as unknown as Parameters<typeof ctx.db.global>[0])
          .insertOne({ tenantId: SYSTEM_TENANT_ID, email: "leak-global@example.com" });
        return { isSuccess: true as const, data: { ok: true as const } };
      },
      { access, rateLimit: RATE_LIMIT, escapeHatch: { reason: GLOBAL_WRITE_REASON } },
    );

    r.writeHandler(
      `global-update-many-${suffix}`,
      z.object({ id: z.uuid() }),
      async (event, ctx) => {
        // @cast-boundary test-fixture — see direct-insert-no-declare above.
        await ctx.db
          .global(globalContactTable as unknown as Parameters<typeof ctx.db.global>[0])
          .updateMany({ email: "overwritten-global@example.com" }, { id: event.payload.id });
        return { isSuccess: true as const, data: { ok: true as const } };
      },
      { access, rateLimit: RATE_LIMIT, escapeHatch: { reason: GLOBAL_WRITE_REASON } },
    );
  }

  // A stream can never declare public-intake (only write handlers can), so an
  // anonymous stream root is always gated.
  r.streamHandler(
    "writeas-detour",
    z.object({ note: z.string() }),
    async function* (query, ctx) {
      const result = await ctx.writeAs(
        createSystemUser(query.user.tenantId),
        "intakeb:write:create",
        {
          email: "leak-stream@example.com",
          note: query.payload.note,
        },
      );
      yield result.isSuccess ? "written" : (result.error.details as { reason?: string })?.reason;
    },
    {
      access: { roles: ["anonymous", "Admin"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: "test: stream detour to prove the gate applies to stream roots" },
    },
  );

  r.writeHandler(
    "non-pii-insert",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      // @cast-boundary test-fixture — only the non-PII `note` column is
      // written here; `email` is deliberately absent so the gate has
      // nothing to block.
      await ctx.db.insertOne(contactTable as unknown as SchemaTable, {
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "mixed-role-insert",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      // @cast-boundary test-fixture — see direct-insert-no-declare above.
      await ctx.db.insertOne(contactTable as unknown as SchemaTable, {
        email: "leak-mixed-role@example.com",
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous", "Admin"] }, rateLimit: RATE_LIMIT },
  );

  // (g) createTenantDb() built by the HANDLER ITSELF from ctx.db.unsafeRaw() — the
  // returned runner carries no TenantDb of its own, so without gate inheritance on the
  // runner (tenant-db.ts's runnerPersonalDataGates) this fresh TenantDb would have no gate.
  const UNSAFE_RAW_REASON =
    "test: proves createTenantDb() built from ctx.db.unsafeRaw() inherits the caller's personal-data gate";

  r.writeHandler(
    "unsafe-raw-tenant-db-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      await createTenantDb(raw, event.user.tenantId, "system").insertOne(
        contactTable as unknown as SchemaTable,
        { email: "leak-unsafe-raw@example.com", note: event.payload.note },
      );
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  r.writeHandler(
    "unsafe-raw-tenant-db-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      await createTenantDb(raw, event.user.tenantId, "system").insertOne(
        contactTable as unknown as SchemaTable,
        { email: "leak-unsafe-raw-declared@example.com", note: event.payload.note },
      );
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    {
      access: { roles: ["anonymous"], personalData: "public-intake" },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  // Nested tx: the handler already runs inside the request's own transaction, so its
  // unsafeRaw runner is a tx handle (.savepoint, not .begin — see asRawClient's own
  // comment). The savepoint-scoped tx a callback receives must inherit the same gate,
  // otherwise a handler could dodge the gate by moving the write inside a savepoint.
  r.writeHandler(
    "unsafe-raw-savepoint-tenant-db-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      await runInSavepoint(raw, async (sp) => {
        await createTenantDb(sp as DbRunner, event.user.tenantId, "system").insertOne(
          contactTable as unknown as SchemaTable,
          { email: "leak-unsafe-raw-tx@example.com", note: event.payload.note },
        );
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  r.writeHandler(
    "unsafe-raw-savepoint-tenant-db-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      await runInSavepoint(raw, async (sp) => {
        await createTenantDb(sp as DbRunner, event.user.tenantId, "system").insertOne(
          contactTable as unknown as SchemaTable,
          { email: "leak-unsafe-raw-tx-declared@example.com", note: event.payload.note },
        );
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    {
      access: { roles: ["anonymous"], personalData: "public-intake" },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  // Raw SQL through the gated proxy itself must stay ungated (decision: unsafeRaw's raw SQL
  // is an escape hatch + audit trail, not something the personal-data gate blocks) — this
  // just proves the proxy stays transparent for a direct tagged-template call.
  r.writeHandler(
    "unsafe-raw-tagged-query-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      // @cast-boundary test-fixture — DbRunner's RawClient arm has no tagged-template call
      // signature; the underlying driver instance (postgres-js/Bun.SQL) does.
      const tagged = raw as unknown as (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<readonly Record<string, unknown>[]>;
      const rows = await tagged`SELECT 1 AS one`;
      if (rows[0]?.["one"] !== 1) throw new Error("tagged query through the proxy failed");
      await createTenantDb(raw, event.user.tenantId, "system").insertOne(
        contactTable as unknown as SchemaTable,
        { email: "leak-unsafe-raw-tagged@example.com", note: event.payload.note },
      );
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    {
      access: { roles: ["anonymous"], personalData: "public-intake" },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  // Authenticated session: same ctx.db.unsafeRaw() -> createTenantDb() path, but the root
  // isn't anonymous, so ctx.db carries no personal-data gate to inherit — unaffected.
  r.writeHandler(
    "unsafe-raw-tenant-db-authenticated",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      await createTenantDb(raw, event.user.tenantId, "system").insertOne(
        contactTable as unknown as SchemaTable,
        { email: "leak-unsafe-raw-authenticated@example.com", note: event.payload.note },
      );
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["Admin"] }, escapeHatch: { reason: UNSAFE_RAW_REASON } },
  );

  // The CRUD executor writes through tenantDbRunner + assertPersonalDataWrite, not
  // insertOne — a TenantDb inheriting its gate only from the runner (not from an explicit
  // grants.personalDataGate) must gate the executor path too, not just direct insertOne.
  r.writeHandler(
    "unsafe-raw-executor-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const scopedDb = createTenantDb(ctx.db.unsafeRaw(), event.user.tenantId, "system");
      const crud = createEventStoreExecutor(contactTable, contactEntity, { entityName: "contact" });
      return crud.create(
        { email: "leak-unsafe-raw-executor@example.com", note: event.payload.note },
        event.user,
        scopedDb,
      );
    },
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );

  // Same inherited-gate TenantDb, but only a non-PII field — proves the proxy/executor
  // combination still appends events and lets the projection run when there is nothing
  // for the gate to block, not merely that it throws.
  r.writeHandler(
    "unsafe-raw-executor-non-pii-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const scopedDb = createTenantDb(ctx.db.unsafeRaw(), event.user.tenantId, "system");
      const crud = createEventStoreExecutor(probeTable, probeEntity, { entityName: "probe" });
      return crud.create({ note: event.payload.note }, event.user, scopedDb);
    },
    {
      access: { roles: ["anonymous"] },
      rateLimit: RATE_LIMIT,
      escapeHatch: { reason: UNSAFE_RAW_REASON },
    },
  );
});

describe("public-intake runtime gate", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [featureB, featureA],
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    await unsafeCreateEntityTable(stack.db, contactEntity);
    await unsafeCreateEntityTable(stack.db, probeEntity);
    await unsafeCreateEntityTable(stack.db, leadEntity, "intakeLead");
    await unsafeCreateEntityTable(stack.db, globalContactEntity, "globalContact");
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe(`DELETE FROM "${contactTable.tableName}"`);
    await asRawClient(stack.db).unsafe(`DELETE FROM "${probeTable.tableName}"`);
    await asRawClient(stack.db).unsafe(`DELETE FROM "${leadTable.tableName}"`);
    await asRawClient(stack.db).unsafe(`DELETE FROM "${globalContactTable.tableName}"`);
  });

  async function rowCount(): Promise<number> {
    const rows = await selectMany(stack.db, contactTable);
    return rows.length;
  }

  async function probeRowCount(): Promise<number> {
    const rows = await selectMany(stack.db, probeTable);
    return rows.length;
  }

  test("(a) direct ctx.db.insertOne on a foreign PII table — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:direct-insert-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    // The 403 reaches anonymous callers: it must not map the schema.
    expect(body.error.details).not.toHaveProperty("target");
    expect(body.error.details).not.toHaveProperty("fields");
    expect(JSON.stringify(body)).not.toContain(contactTable.tableName);
    expect(await rowCount()).toBe(0);
  });

  test("(a) direct ctx.db.insertOne on a foreign PII table — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:direct-insert-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(b) ctx.writeAs(SYSTEM, ...) detour — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:writeas-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(b) ctx.writeAs(SYSTEM, ...) detour — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:writeas-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(c) afterCommit postSave hook writing foreign PII — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:hook-no-declare",
      payload: { note: "x" },
    });
    // The outer write itself already succeeded before the hook ran —
    // afterCommit errors are logged, never surfaced on the HTTP response
    // (flushAfterCommit is awaited inside runBatch before it returns, so
    // there is no race to sleep past). The probe-row assertion proves the
    // hook actually ran (and was gated), not merely that it never fired.
    expect(res.status).toBe(200);
    expect(await probeRowCount()).toBe(1);
    expect(await rowCount()).toBe(0);
  });

  test("(c) afterCommit postSave hook writing foreign PII — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:hook-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await probeRowCount()).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  test("(d) anonymous write -> queryAs(SYSTEM) -> query handler's own ctx.write — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:queryas-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(d) anonymous write -> queryAs(SYSTEM) -> query handler's own ctx.write — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:queryas-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("default entity table name — insertOne and executor create both blocked", async () => {
    for (const type of [
      "intakea:write:default-table-insert-no-declare",
      "intakea:write:default-table-writeas-no-declare",
    ]) {
      const res = await stack.http.raw("POST", "/api/write", { type, payload: { note: "x" } });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { details: { reason: string } } };
      expect(body.error.details.reason).toBe("public_intake_required");
    }
    expect(await selectMany(stack.db, leadTable)).toHaveLength(0);
  });

  describe("update paths on a foreign PII table", () => {
    const SEED_EMAIL = "seed@example.com";

    async function seedContact(): Promise<string> {
      const created = await createEventStoreExecutor(contactTable, contactEntity, {
        entityName: "contact",
      }).create(
        { email: SEED_EMAIL, note: "seed" },
        TestUsers.admin,
        createTenantDb(stack.db, TENANT_ID, "system"),
      );
      if (!created.isSuccess) throw new Error("seed create failed");
      return String(created.data.id);
    }

    async function storedEmail(id: string): Promise<unknown> {
      const rows = await selectMany<Record<string, unknown>>(stack.db, contactTable, { id });
      return rows[0]?.["email"];
    }

    for (const path of ["update-many", "executor-update"]) {
      test(`${path} — blocked without declaration, row untouched`, async () => {
        const id = await seedContact();
        const res = await stack.http.raw("POST", "/api/write", {
          type: `intakea:write:${path}-no-declare`,
          payload: { id },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: { details: { reason: string } } };
        expect(body.error.details.reason).toBe("public_intake_required");
        expect(await storedEmail(id)).toBe(SEED_EMAIL);
      });

      test(`${path} — allowed once declared`, async () => {
        const id = await seedContact();
        const res = await stack.http.raw("POST", "/api/write", {
          type: `intakea:write:${path}-declare`,
          payload: { id },
        });
        expect(res.status).toBe(200);
        expect(await storedEmail(id)).toBe("overwritten@example.com");
      });
    }
  });

  describe("db.global() writes", () => {
    async function globalRows(): Promise<readonly Record<string, unknown>[]> {
      return selectMany<Record<string, unknown>>(stack.db, globalContactTable);
    }

    test("global insertOne — blocked without declaration, nothing stored", async () => {
      const res = await stack.http.raw("POST", "/api/write", {
        type: "intakea:write:global-insert-no-declare",
        payload: { note: "x" },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { details: { reason: string } } };
      expect(body.error.details.reason).toBe("public_intake_required");
      expect(await globalRows()).toHaveLength(0);
    });

    test("global insertOne — allowed once declared", async () => {
      const res = await stack.http.raw("POST", "/api/write", {
        type: "intakea:write:global-insert-declare",
        payload: { note: "x" },
      });
      expect(res.status).toBe(200);
      expect(await globalRows()).toHaveLength(1);
    });

    for (const declared of [false, true]) {
      test(`global updateMany — ${declared ? "allowed once declared" : "blocked without declaration, row untouched"}`, async () => {
        const id = crypto.randomUUID();
        await seedRows(stack.db, globalContactTable, [
          { id, tenantId: SYSTEM_TENANT_ID, email: "seed-global@example.com" },
        ]);
        const res = await stack.http.raw("POST", "/api/write", {
          type: `intakea:write:global-update-many-${declared ? "declare" : "no-declare"}`,
          payload: { id },
        });
        const rows = await globalRows();
        if (declared) {
          expect(res.status).toBe(200);
          expect(rows[0]?.["email"]).toBe("overwritten-global@example.com");
        } else {
          expect(res.status).toBe(403);
          expect(rows[0]?.["email"]).toBe("seed-global@example.com");
        }
      });
    }
  });

  describe("dispatcher.batch with mixed declarations", () => {
    function insertCommand(declared: boolean): { type: string; payload: { note: string } } {
      return {
        type: `intakea:write:direct-insert-${declared ? "declare" : "no-declare"}`,
        payload: { note: "x" },
      };
    }

    test("one undeclared command in an anonymous batch fails the batch and rolls the declared one back", async () => {
      const res = await stack.http.raw("POST", "/api/batch", {
        commands: [insertCommand(true), insertCommand(false)],
      });
      expect(res.status).toBe(403);
      expect(await rowCount()).toBe(0);
    });

    test("an anonymous batch whose commands all declare public-intake commits both", async () => {
      const res = await stack.http.raw("POST", "/api/batch", {
        commands: [insertCommand(true), insertCommand(true)],
      });
      expect(res.status).toBe(200);
      expect(await rowCount()).toBe(2);
    });
  });

  describe("anonymous stream root", () => {
    test("a stream handler's ctx.writeAs detour onto foreign PII is blocked", async () => {
      const res = await stack.http.raw("POST", "/api/stream", {
        type: "intakea:stream:writeas-detour",
        payload: { note: "x" },
      });
      expect(await res.text()).toContain("public_intake_required");
      expect(await rowCount()).toBe(0);
    });

    test("the same stream handler for an authenticated caller writes normally", async () => {
      const headers = { Authorization: `Bearer ${await stack.jwt.sign(TestUsers.admin)}` };
      const res = await stack.http.raw(
        "POST",
        "/api/stream",
        { type: "intakea:stream:writeas-detour", payload: { note: "x" } },
        headers,
      );
      expect(await res.text()).toContain("written");
      expect(await rowCount()).toBe(1);
    });
  });

  test("(e) anonymous write of a non-PII field only — allowed without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:non-pii-insert",
      payload: { note: "hello" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(f) authenticated user on a mixed-role handler (anonymous + Admin) — allowed without declaration", async () => {
    const res = await stack.http.write(
      "intakea:write:mixed-role-insert",
      { note: "hi" },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(g) createTenantDb(ctx.db.unsafeRaw(), ...) — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-tenant-db-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(g) createTenantDb(ctx.db.unsafeRaw(), ...) — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-tenant-db-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(g) createTenantDb(tx, ...) inside savepoint() — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-savepoint-tenant-db-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(g) createTenantDb(tx, ...) inside savepoint() — allowed once declared", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-savepoint-tenant-db-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(g) a tagged-template query through the gated unsafeRaw proxy still works", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-tagged-query-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(g) authenticated session on the same unsafeRaw->createTenantDb path — unaffected", async () => {
    const res = await stack.http.write(
      "intakea:write:unsafe-raw-tenant-db-authenticated",
      { note: "x" },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(1);
  });

  test("(g) createEventStoreExecutor.create through an inherited-gate TenantDb — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-executor-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(g) createEventStoreExecutor.create of a non-PII field through the same inherited-gate TenantDb — allowed", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-executor-non-pii-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(200);
    expect(await probeRowCount()).toBe(1);
  });
});
