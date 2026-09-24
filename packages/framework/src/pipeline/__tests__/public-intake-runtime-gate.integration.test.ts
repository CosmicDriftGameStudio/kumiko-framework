// Every anonymous handler here keeps personal-data keys out of its own input schema,
// so the static boot check passes and only the runtime gate can stop the write.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { SchemaTable } from "../../db";
import type { DbRunner } from "../../db/connection";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, runInSavepoint, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createSystemUser, createTextField, defineFeature } from "../../engine";
import { SYSTEM_ROLE } from "../../engine/system-user";
import type { TenantId } from "../../engine/types";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

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

const featureB = defineFeature("intakeb", (r) => {
  r.entity("contact", contactEntity);
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

  // (g) createTenantDb() built by the HANDLER ITSELF from ctx.db.unsafeRaw(reason) — the
  // returned runner carries no TenantDb of its own, so without gate inheritance on the
  // runner (tenant-db.ts's runnerPersonalDataGates) this fresh TenantDb would have no gate.
  const UNSAFE_RAW_REASON =
    "test: proves createTenantDb() built from ctx.db.unsafeRaw() inherits the caller's personal-data gate";

  r.writeHandler(
    "unsafe-raw-tenant-db-no-declare",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const raw = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
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
      const scopedDb = createTenantDb(
        ctx.db.unsafeRaw(UNSAFE_RAW_REASON),
        event.user.tenantId,
        "system",
      );
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
      const scopedDb = createTenantDb(
        ctx.db.unsafeRaw(UNSAFE_RAW_REASON),
        event.user.tenantId,
        "system",
      );
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
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe(`DELETE FROM "${contactTable.tableName}"`);
    await asRawClient(stack.db).unsafe(`DELETE FROM "${probeTable.tableName}"`);
    await asRawClient(stack.db).unsafe(`DELETE FROM "${leadTable.tableName}"`);
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

  test("(g) createTenantDb(ctx.db.unsafeRaw(reason), ...) — blocked without declaration", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "intakea:write:unsafe-raw-tenant-db-no-declare",
      payload: { note: "x" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("public_intake_required");
    expect(await rowCount()).toBe(0);
  });

  test("(g) createTenantDb(ctx.db.unsafeRaw(reason), ...) — allowed once declared", async () => {
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
