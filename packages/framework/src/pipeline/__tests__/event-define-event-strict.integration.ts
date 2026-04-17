// E.3 — r.defineEvent + ctx.emit strict-mode (B1).
//
// The contract before E.3: ctx.emit accepted any string as eventType and
// any value as payload; the payload went into the events-table raw, typos
// surfaced only at consumer-time. Now:
//
//   1. The event name MUST come from r.defineEvent. Unknown names throw
//      InternalError with a clear hint at the emit site.
//   2. The payload is validated against the registered Zod schema BEFORE
//      it hits the events-table. Mismatches throw ValidationError.
//   3. r.defineEvent returns `{ name: qualifiedName, schema }` — callers
//      pass `def.name` to ctx.emit without building the qn manually.

import { eq, sql as sqlTag } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  createEntityTable,
  setupTestStack,
  sharedWidgetEntity,
  type TestStack,
  TestUsers,
} from "../../testing";

// Capture of the qualified event name defineEvent returns so tests can
// assert against a moving target (kebab/qualifier transformations).
let welcomeEventName = "";

const emitterFeature = defineFeature("emitter", (r) => {
  r.entity("widget", sharedWidgetEntity);

  const welcome = r.defineEvent("user.welcomed", z.object({ userId: z.uuid(), email: z.email() }));
  welcomeEventName = welcome.name;

  r.writeHandler(
    "emit:valid",
    z.object({ userId: z.uuid(), email: z.email() }),
    async (cmd, ctx) => {
      await ctx.emit(welcome.name, cmd.payload);
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit:unknown-event-name",
    z.object({ userId: z.uuid() }),
    async (cmd, ctx) => {
      // Deliberately NOT passing welcome.name — "unknown:event:foobar" was
      // never registered. ctx.emit must reject at the emit site.
      await ctx.emit("emitter:event:not-registered", { userId: cmd.payload.userId });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit:bad-payload",
    z.object({ userId: z.uuid() }),
    async (cmd, ctx) => {
      // userId is correct but email is missing + not an email string.
      await ctx.emit(welcome.name, { userId: cmd.payload.userId, email: "not-an-email" });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );
});

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [emitterFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
});

afterEach(async () => {
  await stack.db.db.execute(
    sqlTag`TRUNCATE events, widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

// --- Tests ---

describe("E.3 — r.defineEvent return + registry wiring", () => {
  test("defineEvent returns qualified name matching registry lookup", () => {
    expect(welcomeEventName).toBe("emitter:event:user-welcomed");
    expect(stack.registry.getEvent(welcomeEventName)).toBeDefined();
  });
});

describe("E.3 — ctx.emit strict validation", () => {
  test("valid emit lands in the events-table with the qualified type", async () => {
    const userId = globalThis.crypto.randomUUID();
    const res = await stack.http.write(
      "emitter:write:emit:valid",
      { userId, email: "welcome@test.de" },
      admin,
    );
    expect(res.status).toBe(200);

    const stored = await stack.db.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, welcomeEventName));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload).toEqual({ userId, email: "welcome@test.de" });
    expect(stored[0]?.aggregateType).toBe("pubsub");
  });

  test("unknown event name throws InternalError; nothing lands in the log", async () => {
    const userId = globalThis.crypto.randomUUID();
    const res = await stack.http.write("emitter:write:emit:unknown-event-name", { userId }, admin);
    // Non-Kumiko throw inside a handler → wrapped as InternalError → 500.
    expect(res.status).toBe(500);

    const stored = await stack.db.db.select().from(eventsTable);
    // TX rolled back: neither a pubsub event NOR the intended aggregate write.
    expect(stored).toHaveLength(0);
  });

  test("payload mismatch throws ValidationError; event not persisted", async () => {
    const userId = globalThis.crypto.randomUUID();
    const res = await stack.http.write("emitter:write:emit:bad-payload", { userId }, admin);
    // ValidationError is a first-class Kumiko error → 400.
    expect(res.status).toBe(400);

    const stored = await stack.db.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, welcomeEventName));
    expect(stored).toHaveLength(0);
  });
});
