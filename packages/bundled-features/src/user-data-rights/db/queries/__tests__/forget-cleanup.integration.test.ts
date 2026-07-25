// kumiko-framework#1525: selectUsersDueForForgetCleanup must not rely on
// globalThis.Temporal when the caller passes a string cutoff (the
// run-forget-cleanup.integration.test.ts suite exercises the full
// pipeline; this is the narrow seam for the ambient-global regression).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../../../user";
import { selectUsersDueForForgetCleanup } from "../forget-cleanup";

let stack: TestStack;

const TENANT = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

beforeAll(async () => {
  stack = await setupTestStack({ features: [createUserFeature()] });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable]);
});

describe("selectUsersDueForForgetCleanup — kumiko-framework#1525: no ambient Temporal global", () => {
  test("string cutoff resolves without relying on globalThis.Temporal", async () => {
    const pastGracePeriodEnd = getTemporal().Now.instant().subtract({ hours: 1 });
    await seedRow(stack.db, userTable, {
      id: USER_ID,
      tenantId: TENANT,
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
