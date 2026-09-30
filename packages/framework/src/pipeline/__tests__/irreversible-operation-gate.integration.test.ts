// Agent-risk floor for irreversible operations (delete on a non-softDelete
// entity, forget on any entity): the directly-dispatched entry handler must
// resolve agent.risk "high", or the executor gate refuses before any DB read.
// Real HTTP calls + setupTestStack — never createTestDispatcher.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import type { Registry } from "../../engine/types/index.js";
import { resolveAgentExposure } from "../../engine/types/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";

const admin = TestUsers.admin;
const NONEXISTENT_ID = "00000000-0000-4000-8000-00000000dead";

const hardEntity = createEntity({
  table: "gate_hard_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const hardTable = buildEntityTable("hard", hardEntity);
const hardExecutor = createEventStoreExecutor(hardTable, hardEntity, { entityName: "hard" });

const softEntity = createEntity({
  table: "gate_soft_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  softDelete: true,
});
const softTable = buildEntityTable("soft", softEntity);
const softExecutor = createEventStoreExecutor(softTable, softEntity, { entityName: "soft" });

const jobForgetRuns: Array<{ readonly id: string }> = [];

const gateFeature = defineFeature("gatetest", (r) => {
  r.entity("hard", hardEntity);
  r.entity("soft", softEntity);

  r.crud("hard", hardEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  r.crud("soft", softEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });

  r.writeHandler(
    "forget-hard-mid",
    z.object({ id: z.uuid() }),
    async (event, ctx) => hardExecutor.forget({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "forget-hard-high",
    z.object({ id: z.uuid() }),
    async (event, ctx) => hardExecutor.forget({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] }, agent: { risk: "high" } },
  );

  r.writeHandler(
    "delete-hard-mid",
    z.object({ id: z.uuid() }),
    async (event, ctx) => hardExecutor.delete({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "delete-soft-mid",
    z.object({ id: z.uuid() }),
    async (event, ctx) => softExecutor.delete({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "delegate-write-to-forget-high",
    z.object({ id: z.uuid() }),
    async (event, ctx) => ctx.write("gatetest:write:forget-hard-high", { id: event.payload.id }),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "delegate-write-as-to-forget-high",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      ctx.writeAs(event.user, "gatetest:write:forget-hard-high", { id: event.payload.id }),
    { access: { roles: ["Admin"] } },
  );

  r.job("forgetHardJob", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const id = payload["id"] as string; // @cast-boundary dynamic-key
    await hardExecutor.forget({ id }, ctx.systemUser, ctx.db);
    jobForgetRuns.push({ id });
  });
});

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [gateFeature], jobs: { consumerLane: "worker" } });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["gate_hard_items", "gate_soft_items"]);
});

async function createHard(label: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "gatetest:write:hard:create",
    { label },
    admin,
  );
  return id;
}

async function createSoft(label: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "gatetest:write:soft:create",
    { label },
    admin,
  );
  return id;
}

// The entity-convention "detail" query returns `data: null` for a missing
// row instead of an HTTP error — assert via queryOk + null, not queryErr.
async function hardRowExists(id: string): Promise<boolean> {
  const row = await stack.http.queryOk("gatetest:query:hard:detail", { id }, admin);
  return row !== null;
}

describe("executor.forget — always irreversible", () => {
  test("mid-risk handler is denied, row survives", async () => {
    const id = await createHard("survives-mid-forget");
    const err = await stack.http.writeErr("gatetest:write:forget-hard-mid", { id }, admin);
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(err.message).toContain("gatetest:write:forget-hard-mid");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("high-risk handler succeeds, row is gone", async () => {
    const id = await createHard("gone-after-high-forget");
    await stack.http.writeOk("gatetest:write:forget-hard-high", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });

  test("nonexistent id at mid-risk still answers 403, not 404", async () => {
    const err = await stack.http.writeErr(
      "gatetest:write:forget-hard-mid",
      { id: NONEXISTENT_ID },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
  });
});

describe("executor.delete — irreversible only without softDelete", () => {
  test("mid-risk handler on a hard-delete entity is denied", async () => {
    const id = await createHard("survives-mid-delete");
    const err = await stack.http.writeErr("gatetest:write:delete-hard-mid", { id }, admin);
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
  });

  test("mid-risk handler on a softDelete entity succeeds", async () => {
    const id = await createSoft("soft-delete-ok");
    await stack.http.writeOk("gatetest:write:delete-soft-mid", { id }, admin);
    const row = await stack.http.queryOk("gatetest:query:soft:detail", { id }, admin);
    expect(row).toBeNull();
  });
});

describe("delegation via ctx.write/writeAs does not inherit the inner handler's risk", () => {
  test("mid handler delegating via ctx.write to a high forget handler is denied", async () => {
    const id = await createHard("delegate-write-denied");
    const err = await stack.http.writeErr(
      "gatetest:write:delegate-write-to-forget-high",
      { id },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("mid handler delegating via ctx.writeAs to a high forget handler is denied", async () => {
    const id = await createHard("delegate-write-as-denied");
    const err = await stack.http.writeErr(
      "gatetest:write:delegate-write-as-to-forget-high",
      { id },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("calling the high handler directly still succeeds", async () => {
    const id = await createHard("direct-high-ok");
    await stack.http.writeOk("gatetest:write:forget-hard-high", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });
});

describe("standard entity-convention delete handler", () => {
  test("resolves to high risk on a non-softDelete entity, mid on a softDelete one", () => {
    const registry = stack.registry as Registry;
    const hardDelete = registry.getWriteHandler("gatetest:write:hard:delete");
    const softDelete = registry.getWriteHandler("gatetest:write:soft:delete");
    if (!hardDelete || !softDelete) throw new Error("delete handlers missing from registry");
    expect(resolveAgentExposure(hardDelete, "write").risk).toBe("high");
    expect(resolveAgentExposure(softDelete, "write").risk).toBe("mid");
  });

  test("succeeds over HTTP on the non-softDelete entity", async () => {
    const id = await createHard("standard-delete-ok");
    await stack.http.writeOk("gatetest:write:hard:delete", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });
});

describe("jobs have no entry handler — the gate stays out of their way", () => {
  test("a job calling executor.forget without a write-handler entry runs through", async () => {
    jobForgetRuns.length = 0;
    const id = await createHard("job-forget-ok");
    await stack.jobRunner?.dispatch("gatetest:job:forget-hard-job", {
      id,
      tenantId: admin.tenantId,
    });
    await waitFor(() => {
      expect(jobForgetRuns.some((run) => run.id === id)).toBe(true);
    });
    expect(await hardRowExists(id)).toBe(false);
  });
});
