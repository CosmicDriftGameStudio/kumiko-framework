// selectUsersDueForForgetCleanup must not rely on
// globalThis.Temporal when the caller passes a string cutoff (the
// run-forget-cleanup.integration.test.ts suite exercises the full
// pipeline; this is the narrow seam for the ambient-global regression).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../../../user/index.ts";
import { selectUsersDueForForgetCleanup } from "../forget-cleanup.ts";

let stack: TestStack;

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

beforeAll(async () => {
  stack = await setupTestStack({ features: [createUserFeature()] });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, eventsTable]);
});

describe("selectUsersDueForForgetCleanup — kumiko-framework#1525: no ambient Temporal global", () => {
  test("string cutoff resolves without relying on globalThis.Temporal", async () => {
    const pastGracePeriodEnd = getTemporal().Now.instant().subtract({ hours: 1 });
    await seedRowViaEventStore(stack.db, userTable, {
      id: USER_ID,
      email: "due@example.com",
      passwordHash: "hashed",
      displayName: "Due User",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: pastGracePeriodEnd,
    });

    // Computed with Temporal intact — only the query call itself runs
    // ambient-free below.
    const cutoffIso = getTemporal().Now.instant().toString();

    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const due = await selectUsersDueForForgetCleanup(
        stack.db,
        USER_STATUS.DeletionRequested,
        cutoffIso,
      );
      expect(due.map((u) => u.id)).toContain(USER_ID);
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});
