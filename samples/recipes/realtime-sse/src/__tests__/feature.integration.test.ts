// Realtime SSE Sample — Integration Test
// Proves: SSE events fire on create, update, delete through the async
// event-dispatcher (D.3). Shape mirrors the StoredEvent: `type` is the
// event type ("message.created"), `data` carries id/version/payload.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { chatFeature, messageEntity } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const user = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [chatFeature] });
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
  test("emits message.updated event with changes", async () => {
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
    const payload = updateEvent?.data["payload"] as Record<string, unknown> | undefined;
    expect(payload?.["changes"]).toEqual({ text: "Edited" });
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
