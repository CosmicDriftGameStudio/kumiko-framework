// Full-stack proof for SelectFieldDef.conditionalOptions: the write path rejects
// an option whose condition on a sibling field does not hold, for create and for
// update against the merged row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor, WritePurposes } from "../db/event-store-executor.js";
import { buildEntityTable } from "../db/table-builder.js";
import {
  createEntity,
  createSelectField,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../engine/index.js";
import { TestUsers } from "../seeding/seed-users.js";

const monitorEntity = createEntity({
  table: "conditional_option_monitors",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    kind: createSelectField({ options: ["http", "heartbeat"] as const, default: "http" }),
    interval: createSelectField({
      options: ["60", "300", "3600"] as const,
      default: "300",
      conditionalOptions: [{ options: ["3600"], when: { field: "kind", eq: "heartbeat" } }],
    }),
  },
});

const monitorTable = buildEntityTable("monitor", monitorEntity);

const monitoring = defineFeature("monitoring", (r) => {
  r.entity({ name: "monitor", ...monitorEntity });
  const executor = createEventStoreExecutor(monitorTable, monitorEntity, {
    entityName: "monitor",
  });
  r.writeHandler({
    name: "monitor:system-set-kind",
    schema: z.object({
      id: z.uuid(),
      kind: z.enum(["http", "heartbeat"]),
      withPurpose: z.boolean(),
    }),
    handler: async (event, ctx) =>
      executor.update(
        { id: event.payload.id, changes: { kind: event.payload.kind } },
        createSystemUser(event.user.tenantId),
        ctx.db,
        {
          skipOptimisticLock: true,
          ...(event.payload.withPurpose && { writePurpose: WritePurposes.erasure }),
        },
      ),
    access: { roles: ["Admin"] },
  });
  r.writeHandler(
    defineEntityCreateHandler("monitor", monitorEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("monitor", monitorEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityDetailHandler("monitor", monitorEntity, { access: { roles: ["Admin"] } }),
  );
});

const CREATE = "monitoring:write:monitor:create";
const UPDATE = "monitoring:write:monitor:update";

describe("SelectFieldDef.conditionalOptions — server enforcement", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [monitoring] });
    await unsafeCreateEntityTable(stack.db, monitorEntity);
  });

  afterAll(() => stack.cleanup());

  async function createMonitor(fields: Record<string, unknown>): Promise<{ id: string }> {
    return stack.http.writeOk<{ id: string }>(CREATE, { name: "m", ...fields }, admin);
  }

  test("create with an unavailable option is rejected with field details", async () => {
    const err = await stack.http.writeErr(
      CREATE,
      { name: "m", kind: "http", interval: "3600" },
      admin,
    );
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({
      reason: "select_option_not_available",
      field: "interval",
      value: "3600",
      allowed: ["60", "300"],
      fields: [{ path: "interval", code: "select_option_not_available" }],
    });
  });

  test("create with the option available passes", async () => {
    await createMonitor({ kind: "heartbeat", interval: "3600" });
  });

  test("update changing only the field to an unavailable option is rejected", async () => {
    const row = await createMonitor({ kind: "http", interval: "60" });
    const err = await stack.http.writeErr(
      UPDATE,
      { id: row.id, changes: { interval: "3600" }, version: 1 },
      admin,
    );
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ reason: "select_option_not_available", field: "interval" });
  });

  test("update changing only the condition field away from the stored option is rejected", async () => {
    const row = await createMonitor({ kind: "heartbeat", interval: "3600" });
    const err = await stack.http.writeErr(
      UPDATE,
      { id: row.id, changes: { kind: "http" }, version: 1 },
      admin,
    );
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ reason: "select_option_not_available", field: "interval" });
  });

  test("update of an unrelated field on a valid row passes", async () => {
    const row = await createMonitor({ kind: "heartbeat", interval: "3600" });
    await stack.http.writeOk(
      UPDATE,
      { id: row.id, changes: { name: "renamed" }, version: 1 },
      admin,
    );
  });

  test("a framework system write with a writePurpose may leave an option unavailable", async () => {
    const row = await createMonitor({ kind: "heartbeat", interval: "3600" });
    await stack.http.writeOk(
      "monitoring:write:monitor:system-set-kind",
      { id: row.id, kind: "http", withPurpose: true },
      admin,
    );
    const stored = await stack.http.queryOk<{ kind: string }>(
      "monitoring:query:monitor:detail",
      { id: row.id },
      admin,
    );
    expect(stored.kind).toBe("http");
  });

  test("a system write without a writePurpose is still checked", async () => {
    const row = await createMonitor({ kind: "heartbeat", interval: "3600" });
    const err = await stack.http.writeErr(
      "monitoring:write:monitor:system-set-kind",
      { id: row.id, kind: "http", withPurpose: false },
      admin,
    );
    expect(err.httpStatus).toBe(422);
  });
});
