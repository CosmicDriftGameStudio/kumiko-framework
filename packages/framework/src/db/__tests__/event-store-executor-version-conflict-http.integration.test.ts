import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { buildEntityTable } from "../table-builder.js";

const noteEntity = createEntity({
  table: "read_vc_http_notes",
  fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
  softDelete: true,
});
const noteTable = buildEntityTable("note", noteEntity);

const noteFeature = defineFeature("vchttp", (r) => {
  r.entity({ name: "note", ...noteEntity });
  const executor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

  r.writeHandler({
    name: "note:create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "note:update",
    schema: z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    handler: async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { title: event.payload.title },
        },
        event.user,
        ctx.db,
      ),
    access: { roles: ["Admin"] },
  });
});

type ErrorBody = {
  readonly error: { readonly code: string; readonly details: Record<string, unknown> };
};

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [noteFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_vc_http_notes"]);
});

describe("version_conflict over HTTP reports the real versions", () => {
  test("update with a stale version → 409 with expectedVersion 1 and currentVersion 2", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "vchttp:write:note:create",
      { title: "v1" },
      admin,
    );
    await stack.http.writeOk("vchttp:write:note:update", { id, version: 1, title: "v2" }, admin);

    const res = await stack.http.write(
      "vchttp:write:note:update",
      { id, version: 1, title: "stale" },
      admin,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("version_conflict");
    expect(body.error.details).toMatchObject({
      entityId: id,
      expectedVersion: 1,
      currentVersion: 2,
    });
  });
});
