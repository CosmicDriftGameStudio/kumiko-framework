// sendDeletionRequestedEmail callback (GDPR Art. 17
// "Secret Promise" email).
//
// Verifies that createUserDataRightsFeature({ sendDeletionRequestedEmail })
// invokes the application callback after a successful deletion-requested flip
// and is best-effort (a send failure does not undo the status flip).
// The comment in handlers/request-deletion.write.ts makes both claims;
// this test verifies them end to end.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write.ts";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";

let stack: TestStack;

const tenantA = testTenantId(1);
const aliceUser = createTestUser({
  id: 42,
  tenantId: tenantA,
  roles: ["Member"],
});

// Mutable callback state for each test: a closure hook reset before each test.
// The stack setup cannot vary per test, so the indirection through `state` is
// necessary.
type CallbackArgs = Parameters<SendDeletionRequestedEmailFn>[0];
type CallbackState = {
  calls: CallbackArgs[];
  shouldThrow: boolean;
};
const state: CallbackState = { calls: [], shouldThrow: false };

const sendDeletionRequestedEmail: SendDeletionRequestedEmailFn = async (args) => {
  state.calls.push(args);
  if (state.shouldThrow) {
    throw new Error("synthetic email transport failure");
  }
};

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature({ sendDeletionRequestedEmail }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  state.calls = [];
  state.shouldThrow = false;
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
});

async function seedAlice(email: string = "alice@example.com"): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: aliceUser.id,
    tenantId: tenantA,
    email,
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    gracePeriodEnd: null,
  });
}

describe("request-deletion :: sendDeletionRequestedEmail callback", () => {
  test("happy: callback feuert mit userEmail + tenantId + gracePeriodEnd nach Status-Flip", async () => {
    const ORIGINAL_EMAIL = "alice.callback.requested@example.com";
    await seedAlice(ORIGINAL_EMAIL);

    const result = await stack.http.writeOk<{
      userId: string;
      status: string;
      gracePeriodEnd: string;
    }>(REQUEST_DELETION, {}, aliceUser);

    expect(result.status).toBe(USER_STATUS.DeletionRequested);

    expect(state.calls).toHaveLength(1);
    const call = state.calls[0];
    expect(call?.userId).toBe(aliceUser.id);
    expect(call?.userEmail).toBe(ORIGINAL_EMAIL);
    expect(call?.tenantId).toBe(tenantA);
    // gracePeriodEnd mapping: the response value equals the callback value. Both
    // refer to the same cleanup-trigger timestamp.
    expect(call?.gracePeriodEnd).toBe(result.gracePeriodEnd);
  });

  test("best-effort: send-throw killt Status-Flip NICHT (DB-State + Response success)", async () => {
    state.shouldThrow = true;
    await seedAlice();

    // Despite the callback throwing, the write remains successful.
    const result = await stack.http.writeOk<{
      userId: string;
      status: string;
      gracePeriodEnd: string;
    }>(REQUEST_DELETION, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.DeletionRequested);

    // The callback ran before the throw.
    expect(state.calls).toHaveLength(1);

    // The database state was actually flipped—the key best-effort proof. If the
    // write bubbled the email-failure exception, the status would still be Active.
    const rows = (await selectMany(stack.db, userTable, { id: aliceUser.id })) as Array<{
      status: string;
    }>;
    expect(rows[0]?.status).toBe(USER_STATUS.DeletionRequested);
  });

  test("422 user_not_found → callback NICHT gefeuert", async () => {
    // Alice was not seeded, so the pre-check fails.
    await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(state.calls).toHaveLength(0);
  });

  test("422 user_not_in_active_state → callback NICHT gefeuert", async () => {
    await seedRow(stack.db, userTable, {
      id: aliceUser.id,
      tenantId: tenantA,
      email: "alice@example.com",
      passwordHash: "hashed",
      displayName: "Alice",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
    });
    await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(state.calls).toHaveLength(0);
  });

  test("user mit leerem email-Feld → callback NICHT gefeuert (skip ohne crash)", async () => {
    // Edge case: the user row has email="" (for example, after prior
    // anonymization left the status hanging). Skipping the callback prevents
    // invalid callback arguments.
    await seedAlice("");

    const result = await stack.http.writeOk<{ status: string }>(REQUEST_DELETION, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.DeletionRequested);
    expect(state.calls).toHaveLength(0);
  });
});
