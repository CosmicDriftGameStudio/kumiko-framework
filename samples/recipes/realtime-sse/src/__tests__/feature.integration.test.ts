// Realtime SSE Sample — Integration Test
// Proves: SSE events fire on create, update, delete through the async
// event-dispatcher (D.3). Shape mirrors the StoredEvent: `type` is the
// event type ("message.created"), `data` carries id/version only: the
// frame is a change signal, clients refetch the record through a query.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { chatFeature, messageEntity, presenceFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const user = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [chatFeature, presenceFeature] });
  await unsafeCreateEntityTable(stack.db, messageEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Advance the event-dispatcher past previous-test events, then reset the
  // collector. Without this, each test would see SSE events stacked up from
  // its predecessors.
  await stack.eventDispatcher?.runOnce();
  stack.events.reset();
});

describe("SSE broadcast on create", () => {
  test("emits message.created event", async () => {
    await stack.http.writeOk<SaveContext>(
      "chat:write:message:create",
      {
        channel: "general",
        text: "Hello world",
        author: "Alice",
      },
      user,
    );

    // SSE is delivered asynchronously by the event-dispatcher. Drain once so
    // the test observes a deterministic state.
    await stack.eventDispatcher?.runOnce();

    expect(stack.events.sse).toHaveLength(1);
    expect(stack.events.sse[0]?.type).toBe("message.created");
    expect(stack.events.sse[0]?.data["id"]).toBeDefined();
  });
});

describe("SSE broadcast on update", () => {
  test("emits a message.updated signal without field values", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "chat:write:message:create",
      {
        channel: "general",
        text: "Original",
      },
      user,
    );

    // Drain the create event, then reset so the update assertion is isolated.
    await stack.eventDispatcher?.runOnce();
    stack.events.reset();

    await stack.http.writeOk<SaveContext>(
      "chat:write:message:update",
      {
        id: created.id,
        changes: { text: "Edited" },
        version: 1,
      },
      user,
    );
    await stack.eventDispatcher?.runOnce();

    const updateEvent = stack.events.sse.find((e) => e.type === "message.updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.data["id"]).toBe(created.id);
    expect(updateEvent?.data["version"]).toBe(2);
    expect(updateEvent?.data).not.toHaveProperty("payload");
  });
});

describe("SSE broadcast on delete", () => {
  test("emits message.deleted event", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "chat:write:message:create",
      {
        channel: "general",
        text: "Delete me",
      },
      user,
    );

    await stack.eventDispatcher?.runOnce();
    stack.events.reset();

    await stack.http.writeOk<SaveContext>("chat:write:message:delete", { id: created.id }, admin);
    await stack.eventDispatcher?.runOnce();

    const deleteEvent = stack.events.sse.find((e) => e.type === "message.deleted");
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent?.data["id"]).toBe(created.id);
  });
});

describe("Presence frames", () => {
  test("a user opening a message they share signals the others on it, by user id", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "chat:write:message:create",
      { channel: "general", text: "Shared" },
      user,
    );
    await stack.eventDispatcher?.runOnce();
    stack.events.reset();
    const open = { entity: "message", id: created.id, activity: "viewing" };

    await stack.http.writeOk("presence:write:heartbeat", open, user);
    const seen = await stack.http.writeOk<{ others: Array<{ userId: string }> }>(
      "presence:write:heartbeat",
      open,
      admin,
    );

    expect(seen.others.map((other) => other.userId)).toEqual([user.id]);
    const frames = stack.events.sse.filter((e) => e.type === "presence:event:changed");
    expect(frames.map((frame) => frame.data["userId"])).toEqual([user.id]);
    expect(frames[0]?.data).not.toHaveProperty("displayName");
  });
});
