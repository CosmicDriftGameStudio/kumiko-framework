import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { runPiiEventBackfill } from "@cosmicdrift/kumiko-framework/migrations";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  dropTestDb,
  setupTestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { helpdeskRequestEntity } from "../entity.ts";
import { HelpdeskHandlers, HelpdeskQueries } from "../web/constants.ts";
import {
  loadReplies,
  loadRequests,
  postSubmit,
  seedAdmin,
  submitBody,
} from "./helpdesk-helpers.ts";
import { createHelpdeskTestStack, type HelpdeskTestStack } from "./helpdesk-test-stack.ts";

const FORMER_REQUEST_ENTITY = "contact-request";
const FORMER_REPLY_ENTITY = "contact-reply";
const FORMER_REQUEST_TABLE = "read_contact_requests";
const FORMER_REQUEST_TYPE = `${FORMER_REQUEST_ENTITY}.created`;
const FORMER_REPLY_TYPE = `${FORMER_REPLY_ENTITY}.created`;

const dbName = `kumiko_helpdesk_former_${generateId().slice(-8)}`;
const formerRequestEntity = { ...helpdeskRequestEntity, table: FORMER_REQUEST_TABLE };
const formerRequestTable = buildEntityTable(FORMER_REQUEST_ENTITY, formerRequestEntity);

let ctx: HelpdeskTestStack;
let admin: SessionUser;

// The database holds the former feature's events and read table before helpdesk boots on it.
async function seedFormerFeatureDatabase(): Promise<void> {
  const seed = await setupTestStack({ features: [], dbName, persistentDb: true });
  try {
    const formerRequestId = generateId();
    await append(seed.db, {
      aggregateId: formerRequestId,
      aggregateType: FORMER_REQUEST_ENTITY,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: FORMER_REQUEST_TYPE,
      payload: { kind: "question", subject: "From before the rename", status: "open" },
      metadata: { userId: SYSTEM_USER_ID },
    });
    await append(seed.db, {
      aggregateId: generateId(),
      aggregateType: FORMER_REPLY_ENTITY,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: FORMER_REPLY_TYPE,
      payload: { requestId: formerRequestId, message: "Answered before the rename" },
      metadata: { userId: SYSTEM_USER_ID },
    });
    await unsafeCreateEntityTable(seed.db, formerRequestEntity, FORMER_REQUEST_ENTITY);
  } finally {
    await seed.cleanup();
  }
}

async function formerEventTypes(): Promise<readonly string[]> {
  const rows = await selectMany(ctx.stack.db, eventsTable, {});
  return rows
    .map((row) => String(row["type"]))
    .filter((type) => type === FORMER_REQUEST_TYPE || type === FORMER_REPLY_TYPE)
    .sort();
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  await seedFormerFeatureDatabase();
  ctx = await createHelpdeskTestStack({}, { dbName, persistentDb: true });
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (baseUrl !== undefined) await dropTestDb(baseUrl, dbName);
});

describe("helpdesk boots on a database that holds the former contact events and table", () => {
  test("the former events and read table survived the boot untouched and inert", async () => {
    expect(await formerEventTypes()).toEqual([FORMER_REPLY_TYPE, FORMER_REQUEST_TYPE]);
    expect(await selectMany(ctx.stack.db, formerRequestTable, {})).toHaveLength(0);
  });

  test("submit, list, detail, reply and mark-done work over HTTP", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { email: "ada@example.com" }),
    );
    expect(res.status).toBe(200);
    const [row] = await loadRequests(ctx.stack);
    const requestId = String(row?.["id"]);

    const list = await ctx.stack.http.queryOk<{ rows: readonly { id: string }[] }>(
      HelpdeskQueries.requestList,
      {},
      admin,
    );
    expect(list.rows.map((r) => r.id)).toEqual([requestId]);

    const detail = await ctx.stack.http.queryOk<{ id: string }>(
      HelpdeskQueries.requestDetail,
      { id: requestId },
      admin,
    );
    expect(detail.id).toBe(requestId);

    await ctx.stack.http.writeOk(
      HelpdeskHandlers.reply,
      { requestId, message: "Use Settings > Export." },
      admin,
    );
    expect(await loadReplies(ctx.stack)).toHaveLength(1);

    await ctx.stack.http.writeOk(HelpdeskHandlers.markDone, { id: requestId }, admin);
    const [done] = await loadRequests(ctx.stack);
    expect(done?.["status"]).toBe("done");
  });

  test("a projection rebuild replays only helpdesk events and leaves the former events alone", async () => {
    const projectionName = [...ctx.stack.registry.getAllProjections().keys()].find(
      (name) => name.startsWith("helpdesk:") && name.includes("helpdesk-request"),
    );
    if (projectionName === undefined) throw new Error("helpdesk request projection not registered");
    const before = await loadRequests(ctx.stack);

    await rebuildProjection(projectionName, { db: ctx.stack.db, registry: ctx.stack.registry });

    expect((await loadRequests(ctx.stack)).map((r) => r["id"])).toEqual(before.map((r) => r["id"]));
    expect(await selectMany(ctx.stack.db, formerRequestTable, {})).toHaveLength(0);
    expect(await formerEventTypes()).toEqual([FORMER_REPLY_TYPE, FORMER_REQUEST_TYPE]);
  });

  test("the boot-time PII backfill runs without failures and skips the former event types", async () => {
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const result = await runPiiEventBackfill(ctx.stack.db, ctx.stack.registry);

    expect(result.status).toBe("ran");
    if (result.status === "ran") expect(result.failures).toEqual([]);
    const formerRows = (await selectMany(ctx.stack.db, eventsTable, {})).filter(
      (row) => row["type"] === FORMER_REQUEST_TYPE,
    );
    expect(formerRows.map((row) => row["payload"])).toEqual([
      { kind: "question", subject: "From before the rename", status: "open" },
    ]);
  });
});
