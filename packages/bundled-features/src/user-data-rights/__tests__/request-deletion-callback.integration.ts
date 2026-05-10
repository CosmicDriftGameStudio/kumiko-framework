// Atom 5b — sendDeletionRequestedEmail Callback (DSGVO Art. 17
// "Geheimes Versprechen"-Email).
//
// Pinst dass createUserDataRightsFeature({ sendDeletionRequestedEmail })
// die App-Author-Callback bei erfolgreichem deletion-requested-Flip
// feuert UND best-effort ist (send-failure killt den Status-Flip nicht).
// Der Code-Comment in handlers/request-deletion.write.ts behauptet beide
// Properties — dieser Test verifiziert sie end-to-end.

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { USER_STATUS, userEntity, userTable } from "../../user";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsFeature } from "../feature";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";

let stack: TestStack;

const tenantA = testTenantId(1);
const aliceUser = createTestUser({
  id: 42,
  tenantId: tenantA,
  roles: ["Member"],
});

// Mutable callback-State pro Test: ein Closure-Hook der pro beforeEach
// reset wird. Stack-Setup laesst sich nicht pro-Test variieren, deshalb
// ist die Indirection ueber `state` noetig.
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
      createUserDataRightsFeature({ sendDeletionRequestedEmail }),
    ],
  });
  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  state.calls = [];
  state.shouldThrow = false;
  await stack.db.delete(userTable);
  await stack.db.execute(sql`DELETE FROM read_tenant_compliance_profiles`);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
});

async function seedAlice(email: string = "alice@example.com"): Promise<void> {
  await stack.db.insert(userTable).values({
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
    // gracePeriodEnd-Mapping: Response-Wert == Callback-Wert. Beide
    // beziehen sich auf denselben Cleanup-Trigger-Timestamp.
    expect(call?.gracePeriodEnd).toBe(result.gracePeriodEnd);
  });

  test("best-effort: send-throw killt Status-Flip NICHT (DB-State + Response success)", async () => {
    state.shouldThrow = true;
    await seedAlice();

    // Trotz callback-Throw bleibt der Write erfolgreich.
    const result = await stack.http.writeOk<{
      userId: string;
      status: string;
      gracePeriodEnd: string;
    }>(REQUEST_DELETION, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.DeletionRequested);

    // Callback wurde aufgerufen (vor dem Throw).
    expect(state.calls).toHaveLength(1);

    // DB-State ist tatsaechlich geflipt — der zentrale "best-effort"-
    // Beweis. Wenn das Write die Email-Failure-Exception bubbelt, waere
    // der Status hier noch Active.
    const rows = (await stack.db
      .select({ status: userTable["status"] })
      .from(userTable)
      .where(eq(userTable["id"], aliceUser.id))
      .limit(1)) as Array<{ status: string }>;
    expect(rows[0]?.status).toBe(USER_STATUS.DeletionRequested);
  });

  test("422 user_not_found → callback NICHT gefeuert", async () => {
    // Alice nicht gesseedet — der Pre-Check failt.
    await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(state.calls).toHaveLength(0);
  });

  test("422 user_not_in_active_state → callback NICHT gefeuert", async () => {
    await stack.db.insert(userTable).values({
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
    // Edge-Case: User-Row hat email="" (z.B. nach voriger Anonymisierung
    // die status haengen liess). Skip schuetzt vor invalid-callback-Args.
    await seedAlice("");

    const result = await stack.http.writeOk<{ status: string }>(REQUEST_DELETION, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.DeletionRequested);
    expect(state.calls).toHaveLength(0);
  });
});
