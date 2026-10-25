// Tests for seedUser. Four invariants:
//   1. The projection row contains email/displayName/passwordHash
//   2. The `user.created` event is written to the aggregate stream
//   3. Idempotency by `email` — a second call returns the same userId
//      without a new insert/event
//   4. The `passwordHash` field is optional (users without a password, such
//      as SSO federation users, must also work)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createUserFeature } from "../feature.ts";
import { userEntity, userTable } from "../schema/user.ts";
import { seedUser } from "../seeding.ts";

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature()],
    extraContext: { configResolver: resolver },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, eventsTable]);
});

describe("seedUser", () => {
  test("writes Projection row with email/displayName/passwordHash", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: "$argon2id$test-hash",
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await selectMany(stack.db, userTable, { email: "alice@example.com" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["email"]).toBe("alice@example.com");
    expect(rows[0]?.["displayName"]).toBe("Alice");
    expect(rows[0]?.["passwordHash"]).toBe("$argon2id$test-hash");
  });

  test("emittiert user.created-Event auf den Aggregate-Stream", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "bob@example.com",
      displayName: "Bob",
    });
    const events = await selectMany(stack.db, eventsTable, { aggregateType: "user" });
    const created = events.filter((e) => e.type === "user.created");
    expect(created).toHaveLength(1);
    expect(created[0]?.aggregateId).toBe(userId);
    const payload = created[0]?.payload as { email: string; displayName: string };
    expect(payload.email).toBe("bob@example.com");
    expect(payload.displayName).toBe("Bob");
  });

  test("idempotent by email — second call returns the same userId, no second event", async () => {
    const first = await seedUser(stack.db, {
      email: "carol@example.com",
      displayName: "Carol",
    });
    const second = await seedUser(stack.db, {
      email: "carol@example.com",
      displayName: "Carol Updated",
    });
    expect(second.id).toBe(first.id);

    const rows = await selectMany(stack.db, userTable, { email: "carol@example.com" });
    expect(rows).toHaveLength(1);
    // The original displayName remains — the second call was skipped, so no update occurred.
    expect(rows[0]?.["displayName"]).toBe("Carol");

    const created = await selectMany(stack.db, eventsTable, { aggregateType: "user" });
    expect(created.filter((e) => e.type === "user.created")).toHaveLength(1);
  });

  test("passwordHash optional — user without a hash can be created (e.g. SSO-Federation)", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "dave@example.com",
      displayName: "Dave",
    });
    const [row] = await selectMany(stack.db, userTable, { id: userId });
    expect(row?.["passwordHash"]).toBeNull();
  });

  test("reconciles emailVerified:true for an already seeded user", async () => {
    const first = await seedUser(stack.db, {
      email: "frank@example.com",
      displayName: "Frank",
    });
    const [rowBefore] = await selectMany(stack.db, userTable, { id: first.id });
    expect(rowBefore?.["emailVerified"]).not.toBe(true);

    const second = await seedUser(stack.db, {
      email: "frank@example.com",
      displayName: "Frank",
      emailVerified: true,
    });
    expect(second.id).toBe(first.id);

    const [rowAfter] = await selectMany(stack.db, userTable, { id: first.id });
    expect(rowAfter?.["emailVerified"]).toBe(true);

    const updated = await selectMany(stack.db, eventsTable, {
      aggregateType: "user",
      type: "user.updated",
    });
    expect(updated).toHaveLength(1);
  });

  test("default `by` is the system user (audit trail)", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "eve@example.com",
      displayName: "Eve",
    });
    const [row] = await selectMany(stack.db, userTable, { id: userId });
    expect(row?.["insertedById"]).toBe(SYSTEM_USER_ID);
  });
});
