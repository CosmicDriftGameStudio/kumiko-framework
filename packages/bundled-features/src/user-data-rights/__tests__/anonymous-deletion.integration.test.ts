// Anonymer, email-verifizierter Deletion-Flow (Apex, Lockout-sicher).
//
// Schritt 1 (request-deletion-by-email): anonym, enumeration-safe, signt ein
// HMAC-Token + ruft den Verify-Mail-Callback. Schritt 2 (confirm-deletion-by-
// token): anonym, verifiziert das Token + startet die Grace-Period.
// Beweist end-to-end via echte /api/write-Calls OHNE Auth (anonymousAccess).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { USER_STATUS, userEntity, userTable } from "../../user";
import { createUserFeature } from "../../user/feature";
import { signDeletionToken } from "../deletion-token";
import { createUserDataRightsFeature } from "../feature";
import type { SendDeletionVerificationEmailFn } from "../handlers/request-deletion-by-email.write";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";
const CONFIRM_BY_TOKEN = "user-data-rights:write:confirm-deletion-by-token";
const DELETION_SECRET = "test-deletion-secret-0123456789abcdef";
const VERIFY_URL = "https://app.example.test/delete-account/confirm";

const tenantA = testTenantId(1);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const ALICE_EMAIL = "alice.anon@example.com";

type VerifyArgs = Parameters<SendDeletionVerificationEmailFn>[0];
const verifyCalls: VerifyArgs[] = [];
const sendDeletionVerificationEmail: SendDeletionVerificationEmailFn = async (args) => {
  verifyCalls.push(args);
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature({
        deletionTokenSecret: DELETION_SECRET,
        deletionVerifyUrl: VERIFY_URL,
        sendDeletionVerificationEmail,
      }),
    ],
    anonymousAccess: { defaultTenantId: tenantA },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  verifyCalls.length = 0;
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
});

async function seedAlice(status: string = USER_STATUS.Active, email: string = ALICE_EMAIL) {
  await insertOne(stack.db, userTable, {
    id: aliceUser.id,
    tenantId: tenantA,
    email,
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status,
    gracePeriodEnd: null,
  });
}

function tokenFromLastVerifyCall(): string {
  const url = new URL(verifyCalls[0]?.verifyUrl ?? "");
  return url.searchParams.get("token") ?? "";
}

async function statusOf(): Promise<string | undefined> {
  const rows = (await selectMany(stack.db, userTable, { id: aliceUser.id })) as Array<{
    status: string;
  }>;
  return rows[0]?.status;
}

describe("anonymous deletion flow", () => {
  test("request-by-email (anonym) für aktiven User → success + Verify-Mail mit Token", async () => {
    await seedAlice();

    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]?.email).toBe(ALICE_EMAIL);
    expect(verifyCalls[0]?.verifyUrl.startsWith(`${VERIFY_URL}?token=`)).toBe(true);
    expect(tokenFromLastVerifyCall().length).toBeGreaterThan(0);
    // Status noch NICHT geflipt — erst confirm startet die Grace-Period.
    expect(await statusOf()).toBe(USER_STATUS.Active);
  });

  test("confirm-by-token (anonym) mit echtem Token → Grace-Period gestartet", async () => {
    await seedAlice();
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token = tokenFromLastVerifyCall();

    const res = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      data: { status: string; gracePeriodEnd: string };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.data.status).toBe(USER_STATUS.DeletionRequested);
    expect(body.data.gracePeriodEnd.length).toBeGreaterThan(0);

    // DB-State tatsächlich geflipt + gracePeriodEnd gesetzt.
    const rows = (await selectMany(stack.db, userTable, { id: aliceUser.id })) as Array<{
      status: string;
      gracePeriodEnd: unknown;
    }>;
    expect(rows[0]?.status).toBe(USER_STATUS.DeletionRequested);
    expect(rows[0]?.gracePeriodEnd).not.toBeNull();
  });

  test("confirm-replay (anonym): zweites Confirm mit gleichem Token → 422, Status unverändert", async () => {
    await seedAlice();
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token = tokenFromLastVerifyCall();

    const first = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(first.status).toBe(200);
    expect(await statusOf()).toBe(USER_STATUS.DeletionRequested);

    // Token ist bewusst replaybar (kein single-use); die Replay-Sicherheit kommt
    // allein aus dem Active-State-Guard — zweites Confirm trifft non-active → 422.
    const second = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(second.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.DeletionRequested);
  });

  test("request-by-email für nicht-existente Email → success, KEINE Mail (enumeration-safe)", async () => {
    await seedAlice();
    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: "ghost@example.com" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);
    expect(verifyCalls).toHaveLength(0);
  });

  test("request-by-email für non-active User → success, KEINE Mail", async () => {
    await seedAlice(USER_STATUS.DeletionRequested);
    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);
    expect(verifyCalls).toHaveLength(0);
  });

  test("confirm mit Garbage-Token → 422, Status unverändert", async () => {
    await seedAlice();
    const res = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: "not.a.realtoken" },
    });
    expect(res.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);
  });

  test("confirm mit falsch-signiertem Token → 422", async () => {
    await seedAlice();
    const { token } = signDeletionToken(aliceUser.id, 60, "the-wrong-secret-totally-different");
    const res = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(res.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);
  });
});

describe("anonymous deletion flow — not configured (kein Secret)", () => {
  let bareStack: TestStack;
  const bareVerifyCalls: VerifyArgs[] = [];

  beforeAll(async () => {
    bareStack = await setupTestStack({
      features: [
        createUserFeature(),
        createDataRetentionFeature(),
        createComplianceProfilesFeature(),
        createSessionsFeature(),
        createUserDataRightsFeature({
          sendDeletionVerificationEmail: async (args) => {
            bareVerifyCalls.push(args);
          },
        }),
      ],
      anonymousAccess: { defaultTenantId: tenantA },
    });
    await unsafeCreateEntityTable(bareStack.db, userEntity);
    await unsafeCreateEntityTable(bareStack.db, tenantComplianceProfileEntity);
    await createEventsTable(bareStack.db);
    await insertOne(bareStack.db, userTable, {
      id: aliceUser.id,
      tenantId: tenantA,
      email: ALICE_EMAIL,
      passwordHash: "hashed",
      displayName: "Alice",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
      gracePeriodEnd: null,
    });
  });

  afterAll(async () => {
    await bareStack.cleanup();
  });

  test("request-by-email ohne Secret → success no-op, KEINE Mail", async () => {
    const res = await bareStack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);
    expect(bareVerifyCalls).toHaveLength(0);
  });

  test("confirm ohne Secret → 422", async () => {
    const { token } = signDeletionToken(aliceUser.id, 60, DELETION_SECRET);
    const res = await bareStack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(res.status).toBe(422);
  });
});
