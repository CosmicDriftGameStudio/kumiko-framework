// Operator surface for event consumers over real HTTP: a projection that throws on one
// event drives its consumer to "dead"; restart/skip/disable/enable act on that real state.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { getConsumerState } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createJobsFeature } from "../feature.ts";
import { consumerRowId } from "../handlers/consumers.query.ts";
import { JobErrors, JobHandlers, JobQueries } from "../web/constants.ts";

const POISON_NAME = "poison";
const MAX_PASSES_TO_DEAD = 12;

const noteEntity = createEntity({
  table: "read_consumerdrill_notes",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

let poisonArmed = true;
const observed: string[] = [];

const drillFeature = defineFeature("consumerdrill", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: { roles: ["Admin"] } }));
  r.multiStreamProjection({
    name: "observer",
    apply: {
      "note.created": async (event) => {
        const name = String(event.payload["name"]);
        if (poisonArmed && name === POISON_NAME) {
          throw new Error("secret-handler-failure-text");
        }
        observed.push(name);
      },
    },
  });
});

const CONSUMER = "consumerdrill:projection:observer";
const SHARED = "__shared__";
const rowId = consumerRowId(CONSUMER, SHARED);
const target = { name: CONSUMER, instanceId: SHARED };

const admin = TestUsers.admin;
const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin: SessionUser = createTestUser({ id: 3, roles: ["TenantAdmin"] });

type ConsumerRow = {
  readonly id: string;
  readonly status: string;
  readonly lastError: string | null;
  readonly attempts: number;
};

let stack: TestStack;

async function createNote(name: string): Promise<void> {
  await stack.http.writeOk("consumerdrill:write:note:create", { name }, admin);
}

async function runPasses(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await stack.eventDispatcher?.runOnce();
}

async function listedRow(): Promise<ConsumerRow | undefined> {
  const res = await stack.http.queryOk<{ rows: readonly ConsumerRow[] }>(
    JobQueries.consumers,
    {},
    systemAdmin,
  );
  return res.rows.find((row) => row.id === rowId);
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), drillFeature, createJobsFeature()],
    systemHooks: [],
  });
  await createNote("first");
  await createNote(POISON_NAME);
  await createNote("after-poison");
  await runPasses(MAX_PASSES_TO_DEAD);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("event consumer admin over HTTP", () => {
  test("a throwing projection leaves its consumer dead and the list shows the error first", async () => {
    const res = await stack.http.queryOk<{ rows: readonly ConsumerRow[] }>(
      JobQueries.consumers,
      {},
      systemAdmin,
    );
    expect(res.rows[0]?.id).toBe(rowId);
    const row = await listedRow();
    expect(row?.status).toBe("dead");
    expect(row?.lastError).toContain("secret-handler-failure-text");
    expect(observed).toEqual(["first"]);
  });

  test("detail returns the full error", async () => {
    const detail = await stack.http.queryOk<{ lastError: string; status: string }>(
      JobQueries.consumerDetails,
      { consumerId: rowId },
      systemAdmin,
    );
    expect(detail.status).toBe("dead");
    expect(detail.lastError).toContain("secret-handler-failure-text");
  });

  test("restart without a fix retries the same event and dies again", async () => {
    const ok = await stack.http.writeOk<{ status: string }>(
      JobHandlers.consumerRestart,
      target,
      systemAdmin,
    );
    expect(ok.status).toBe("idle");
    await runPasses(MAX_PASSES_TO_DEAD);
    expect((await listedRow())?.status).toBe("dead");
    expect(observed).toEqual(["first"]);
  });

  test("restart succeeds once the cause is fixed and delivers the stuck event", async () => {
    poisonArmed = false;
    await stack.http.writeOk(JobHandlers.consumerRestart, target, systemAdmin);
    await runPasses(3);
    expect((await listedRow())?.status).toBe("idle");
    expect(observed).toEqual(["first", POISON_NAME, "after-poison"]);
    poisonArmed = true;
  });

  test("skip moves past the failing event and later events flow again", async () => {
    await createNote(POISON_NAME);
    await createNote("after-skip");
    await runPasses(MAX_PASSES_TO_DEAD);
    const dead = await getConsumerState(stack.db, CONSUMER);
    expect(dead?.status).toBe("dead");
    const cursorBefore = dead?.lastProcessedEventId ?? 0n;

    const skipped = await stack.http.writeOk<{ status: string; skippedEventId: string | null }>(
      JobHandlers.consumerSkip,
      target,
      systemAdmin,
    );
    expect(skipped.status).toBe("idle");
    expect(BigInt(skipped.skippedEventId ?? "0")).toBeGreaterThan(cursorBefore);

    await runPasses(3);
    expect((await listedRow())?.status).toBe("idle");
    expect(observed.at(-1)).toBe("after-skip");
    expect(observed.filter((n) => n === POISON_NAME)).toHaveLength(1);
  });

  test("disable pauses delivery, enable resumes it", async () => {
    const disabled = await stack.http.writeOk<{ status: string }>(
      JobHandlers.consumerDisable,
      target,
      systemAdmin,
    );
    expect(disabled.status).toBe("disabled");
    await createNote("while-paused");
    await runPasses(3);
    expect((await listedRow())?.status).toBe("disabled");
    expect(observed).not.toContain("while-paused");

    const enabled = await stack.http.writeOk<{ status: string }>(
      JobHandlers.consumerEnable,
      target,
      systemAdmin,
    );
    expect(enabled.status).toBe("idle");
    await runPasses(3);
    expect(observed).toContain("while-paused");
  });

  test("rejections carry fixed codes and never the internal error text", async () => {
    const wrongStatus = await stack.http.writeErr(JobHandlers.consumerRestart, target, systemAdmin);
    expect(JSON.stringify(wrongStatus)).toContain(JobErrors.consumerWrongStatus);
    expect(JSON.stringify(wrongStatus)).not.toContain("status=");

    const unknown = await stack.http.writeErr(
      JobHandlers.consumerRestart,
      { name: "consumerdrill:projection:missing", instanceId: SHARED },
      systemAdmin,
    );
    expect(JSON.stringify(unknown)).toContain(JobErrors.consumerUnknown);
    expect(JSON.stringify(unknown)).not.toContain("state row");

    const cursorBefore = (await getConsumerState(stack.db, CONSUMER))?.lastProcessedEventId;
    const skipOnIdle = await stack.http.writeErr(JobHandlers.consumerSkip, target, systemAdmin);
    expect(JSON.stringify(skipOnIdle)).toContain(JobErrors.consumerWrongStatus);
    const after = await getConsumerState(stack.db, CONSUMER);
    expect(after?.lastProcessedEventId).toBe(cursorBefore);
    expect(after?.status).toBe("idle");
  });

  test("non-SystemAdmin gets 403 on queries and every transition", async () => {
    const calls = [
      () => stack.http.query(JobQueries.consumers, {}, tenantAdmin),
      () => stack.http.query(JobQueries.consumerDetails, { consumerId: rowId }, tenantAdmin),
      () => stack.http.write(JobHandlers.consumerRestart, target, tenantAdmin),
      () => stack.http.write(JobHandlers.consumerSkip, target, tenantAdmin),
      () => stack.http.write(JobHandlers.consumerDisable, target, tenantAdmin),
      () => stack.http.write(JobHandlers.consumerEnable, target, tenantAdmin),
    ];
    for (const call of calls) expect((await call()).status).toBe(403);
  });
});
