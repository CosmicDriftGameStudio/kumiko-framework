// E.3 — r.defineEvent + ctx.appendEvent strict-mode (B1).
//
// Pre-E.3 ctx accepted any string as eventType and any value as payload;
// payload went into the events-table raw, typos surfaced only at consumer-
// time. Now:
//
//   1. The event name MUST come from r.defineEvent. Unknown names throw
//      InternalError with a clear hint at the append site.
//   2. The payload is validated against the registered Zod schema BEFORE
//      it hits the events-table. Mismatches throw ValidationError.
//   3. r.defineEvent returns `{ name: qualifiedName, schema }` — callers
//      pass `def.name` to ctx.appendEvent without building the qn manually.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { selectMany } from "../../bun-db/query";
import { defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity } from "../../testing";
import { generateId } from "../../utils";

// Capture of the qualified event name defineEvent returns so tests can
// assert against a moving target (kebab/qualifier transformations).
let welcomeEventName = "";
let foreignEventName = "";

// Second feature owning its own event. The emitter feature below tries to
// emit this from one of its handlers — Sprint-E cross-feature-ownership
// guard must reject it at the append site.
const neighborFeature = defineFeature("neighbor", (r) => {
  const foreign = r.defineEvent("neighbor.signal", z.object({ userId: z.uuid() }));
  foreignEventName = foreign.name;
});

const emitterFeature = defineFeature("emitter", (r) => {
  r.entity("widget", sharedWidgetEntity);

  const welcome = r.defineEvent("user.welcomed", z.object({ userId: z.uuid(), email: z.email() }));
  welcomeEventName = welcome.name;

  r.writeHandler(
    "emit:valid",
    z.object({ userId: z.uuid(), email: z.email() }),
    async (cmd, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: cmd.payload.userId,
        aggregateType: "user",
        type: welcome.name,
        payload: cmd.payload,
      });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit:unknown-event-name",
    z.object({ userId: z.uuid() }),
    async (cmd, ctx) => {
      // Deliberately NOT passing welcome.name — "emitter:event:not-registered"
      // was never registered. ctx.appendEvent must reject at the append site.
      await ctx.unsafeAppendEvent({
        aggregateId: cmd.payload.userId,
        aggregateType: "user",
        type: "emitter:event:not-registered",
        payload: { userId: cmd.payload.userId },
      });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit:bad-payload",
    z.object({ userId: z.uuid() }),
    async (cmd, ctx) => {
      // userId is correct but email is missing / not an email string.
      await ctx.unsafeAppendEvent({
        aggregateId: cmd.payload.userId,
        aggregateType: "user",
        type: welcome.name,
        payload: { userId: cmd.payload.userId, email: "not-an-email" },
      });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit:foreign-event",
    z.object({ userId: z.uuid() }),
    async (cmd, ctx) => {
      // "neighbor:event:neighbor-signal" is owned by the neighbor feature.
      // The ownership guard in appendDomainEventCore must reject this append
      // at emit-site — cross-feature emission silently breaks encapsulation.
      await ctx.unsafeAppendEvent({
        aggregateId: cmd.payload.userId,
        aggregateType: "user",
        type: foreignEventName,
        payload: { userId: cmd.payload.userId },
      });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.userId } };
    },
    { access: { roles: ["Admin"] } },
  );
});

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [emitterFeature, neighborFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

// --- Tests ---

describe("E.3 — r.defineEvent return + registry wiring", () => {
  test("defineEvent returns qualified name matching registry lookup", () => {
    expect(welcomeEventName).toBe("emitter:event:user-welcomed");
    expect(stack.registry.getEvent(welcomeEventName)).toBeDefined();
  });
});

describe("E.3 — ctx.appendEvent strict validation", () => {
  test("valid append lands in the events-table with the qualified type on the aggregate stream", async () => {
    const userId = generateId();
    const res = await stack.http.write(
      "emitter:write:emit:valid",
      { userId, email: "welcome@test.de" },
      admin,
    );
    expect(res.status).toBe(200);

    const stored = await selectMany(stack.db, eventsTable, { type: welcomeEventName });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload).toEqual({ userId, email: "welcome@test.de" });
    expect(stored[0]?.aggregateType).toBe("user");
    expect(stored[0]?.aggregateId).toBe(userId);
    // Fresh aggregate → version 1 (Block 0 getStreamVersion returns 0, append bumps to 1).
    expect(stored[0]?.version).toBe(1);
  });

  test("unknown event name throws InternalError; nothing lands in the log", async () => {
    const userId = generateId();
    const res = await stack.http.write("emitter:write:emit:unknown-event-name", { userId }, admin);
    // Non-Kumiko throw inside a handler → wrapped as InternalError → 500.
    expect(res.status).toBe(500);

    const stored = await selectMany(stack.db, eventsTable);
    // TX rolled back: no event landed.
    expect(stored).toHaveLength(0);
  });

  test("payload mismatch throws ValidationError; event not persisted", async () => {
    const userId = generateId();
    const res = await stack.http.write("emitter:write:emit:bad-payload", { userId }, admin);
    // ValidationError is a first-class Kumiko error → 400.
    expect(res.status).toBe(400);

    const stored = await selectMany(stack.db, eventsTable, { type: welcomeEventName });
    expect(stored).toHaveLength(0);
  });
});

describe("E.3 — cross-feature ownership guard", () => {
  test("emitter cannot ctx.appendEvent an event owned by another feature", async () => {
    // neighbor:event:neighbor-signal is a registered event — but it lives
    // in the neighbor feature, not the emitter. Without the guard the
    // append would succeed silently, attaching a "foreign" event onto the
    // emitter's aggregate stream and undermining feature encapsulation.
    const userId = generateId();
    const res = await stack.http.write("emitter:write:emit:foreign-event", { userId }, admin);
    expect(res.status).toBe(500);

    const stored = await selectMany(stack.db, eventsTable, { type: foreignEventName });
    expect(stored).toHaveLength(0);
  });
});
