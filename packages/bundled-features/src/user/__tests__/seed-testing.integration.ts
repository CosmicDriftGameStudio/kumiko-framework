// Tests für seedUser. Vier Invarianten:
//   1. Projection-Row landet mit email/displayName/passwordHash
//   2. Event `user.created` landet auf dem Aggregate-Stream
//   3. Idempotenz über `email` — zweiter Call liefert dieselbe userId
//      ohne neuen Insert/Event
//   4. `passwordHash`-Field ist optional (User ohne Passwort, z.B. SSO-
//      Federation, soll auch funktionieren)

import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/stack";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../feature";
import { userEntity, userTable } from "../schema/user";
import { seedUser } from "../seeding";

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature()],
    extraContext: { configResolver: resolver },
  });
  await createEntityTable(stack.db, userEntity);
  await pushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.delete(eventsTable);
});

describe("seedUser", () => {
  test("schreibt Projection-Row mit email/displayName/passwordHash", async () => {
    const userId = await seedUser(stack.db, {
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: "$argon2id$test-hash",
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await stack.db
      .select()
      .from(userTable)
      .where(eq(userTable["email"], "alice@example.com"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["email"]).toBe("alice@example.com");
    expect(rows[0]?.["displayName"]).toBe("Alice");
    expect(rows[0]?.["passwordHash"]).toBe("$argon2id$test-hash");
  });

  test("emittiert user.created-Event auf den Aggregate-Stream", async () => {
    const userId = await seedUser(stack.db, {
      email: "bob@example.com",
      displayName: "Bob",
    });
    const events = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "user"));
    const created = events.filter((e) => e.type === "user.created");
    expect(created).toHaveLength(1);
    expect(created[0]?.aggregateId).toBe(userId);
    const payload = created[0]?.payload as { email: string; displayName: string };
    expect(payload.email).toBe("bob@example.com");
    expect(payload.displayName).toBe("Bob");
  });

  test("idempotent über email — zweiter Call liefert dieselbe userId, kein zweites Event", async () => {
    const first = await seedUser(stack.db, {
      email: "carol@example.com",
      displayName: "Carol",
    });
    const second = await seedUser(stack.db, {
      email: "carol@example.com",
      displayName: "Carol Updated",
    });
    expect(second).toBe(first);

    const rows = await stack.db
      .select()
      .from(userTable)
      .where(eq(userTable["email"], "carol@example.com"));
    expect(rows).toHaveLength(1);
    // Original-displayName bleibt — zweiter Call wurde geskippt, kein update.
    expect(rows[0]?.["displayName"]).toBe("Carol");

    const created = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "user"));
    expect(created.filter((e) => e.type === "user.created")).toHaveLength(1);
  });

  test("passwordHash optional — User ohne Hash anlegbar (z.B. SSO-Federation)", async () => {
    const userId = await seedUser(stack.db, {
      email: "dave@example.com",
      displayName: "Dave",
    });
    const [row] = await stack.db.select().from(userTable).where(eq(userTable["id"], userId));
    expect(row?.["passwordHash"]).toBeNull();
  });

  test("default `by` ist TestUsers.systemAdmin (für audit-trail)", async () => {
    const userId = await seedUser(stack.db, {
      email: "eve@example.com",
      displayName: "Eve",
    });
    const [row] = await stack.db.select().from(userTable).where(eq(userTable["id"], userId));
    expect(row?.["insertedById"]).toBe(TestUsers.systemAdmin.id);
  });
});
