import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createDateField,
  createEntity,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

// Handlers that fan out executor writes with Promise.all on ctx.db share one transaction.
// Every write opens savepoints on it; they must not release or roll back each other's.

const contactEntity = createEntity({
  table: "pew_contacts",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  indexes: [{ columns: ["tenantId", "label"], unique: true, name: "pew_contacts_label_uniq" }],
});
const contactTable = buildEntityTable("contact", contactEntity);
const contactCrud = createEventStoreExecutor(contactTable, contactEntity, {
  entityName: "contact",
});

const appointmentEntity = createEntity({
  table: "pew_appointments",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    day: createDateField({ required: true }),
  },
});
const appointmentTable = buildEntityTable("appointment", appointmentEntity);
const appointmentCrud = createEventStoreExecutor(appointmentTable, appointmentEntity, {
  entityName: "appointment",
});

const admin = TestUsers.admin;
let stack: TestStack;
let lastParallelResults: ReadonlyArray<{ readonly isSuccess: boolean }> = [];

const parallelFeature = defineFeature("pew", (r) => {
  r.entity({ name: "contact", ...contactEntity });
  r.entity({ name: "appointment", ...appointmentEntity });

  r.writeHandler({
    name: "contact:create-all",
    schema: z.object({ labels: z.array(z.string()) }),
    handler: async (event, ctx) => {
      const results = await Promise.all(
        event.payload.labels.map((label) => contactCrud.create({ label }, event.user, ctx.db)),
      );
      return results.find((result) => !result.isSuccess) ?? { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "contact:create-all-tolerant",
    schema: z.object({ labels: z.array(z.string()) }),
    handler: async (event, ctx) => {
      lastParallelResults = await Promise.all(
        event.payload.labels.map((label) => contactCrud.create({ label }, event.user, ctx.db)),
      );
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  // Payload schema deliberately accepts any string: the app forgot to validate the day.
  r.writeHandler({
    name: "appointment:create",
    schema: z.object({ label: z.string(), day: z.string() }),
    handler: async (event, ctx) => appointmentCrud.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
});

async function labelsWithPrefix(
  table: typeof contactTable | typeof appointmentTable,
  prefix: string,
): Promise<string[]> {
  const rows = await selectMany(stack.db, table);
  return (rows as Array<Record<string, unknown>>)
    .map((row) => String(row["label"]))
    .filter((label) => label.startsWith(prefix))
    .sort();
}

async function eventCountMentioning(marker: string): Promise<number> {
  const rows = await selectMany(stack.db, eventsTable);
  return (rows as Array<Record<string, unknown>>).filter((row) =>
    JSON.stringify(row["payload"]).includes(marker),
  ).length;
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [parallelFeature] });
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await unsafeCreateEntityTable(stack.db, appointmentEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  lastParallelResults = [];
  await stack.redis.flushNamespace();
});

describe("parallel executor writes on one handler transaction", () => {
  test("Promise.all of creates on ctx.db commits every row", async () => {
    const labels = ["p1-a", "p1-b", "p1-c", "p1-d", "p1-e"];
    const res = await stack.http.write("pew:write:contact:create-all", { labels }, admin);

    expect(res.status).toBe(200);
    expect((await res.json()).isSuccess).toBe(true);
    expect(await labelsWithPrefix(contactTable, "p1-")).toEqual(labels);
    expect(await eventCountMentioning("p1-")).toBe(labels.length);
  });

  test("a failing create does not discard its parallel siblings", async () => {
    const seeded = await stack.http.write(
      "pew:write:contact:create-all",
      { labels: ["p2-taken"] },
      admin,
    );
    expect(seeded.status).toBe(200);

    const res = await stack.http.write(
      "pew:write:contact:create-all-tolerant",
      { labels: ["p2-a", "p2-taken", "p2-b", "p2-c"] },
      admin,
    );

    expect(res.status).toBe(200);
    expect(lastParallelResults.map((result) => result.isSuccess)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(await labelsWithPrefix(contactTable, "p2-")).toEqual([
      "p2-a",
      "p2-b",
      "p2-c",
      "p2-taken",
    ]);
    for (const sibling of ["p2-a", "p2-b", "p2-c"]) {
      expect(await eventCountMentioning(sibling)).toBe(1);
    }
  });
});

describe("invalid date values reaching a date column", () => {
  test.each([
    ["a day that does not exist in the month", "2026-02-30"],
    ["a string that is not a date", "not-a-date"],
  ])("%s is a 400 validation error and leaves no row or event", async (_case, day) => {
    const label = `d-${day}`;
    const res = await stack.http.write("pew:write:appointment:create", { label, day }, admin);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("validation_error");
    expect(await labelsWithPrefix(appointmentTable, label)).toEqual([]);
    expect(await eventCountMentioning(label)).toBe(0);
  });
});
