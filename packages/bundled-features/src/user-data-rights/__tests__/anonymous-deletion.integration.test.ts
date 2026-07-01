// Anonymer, email-verifizierter Deletion-Flow (Apex, Lockout-sicher).
//
// Schritt 1 (request-deletion-by-email): anonym, enumeration-safe, signt ein
// HMAC-Token + ruft den Verify-Mail-Callback. Schritt 2 (confirm-deletion-by-
// token): anonym, verifiziert das Token + startet die Grace-Period.
// Beweist end-to-end via echte /api/write-Calls OHNE Auth (anonymousAccess).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-framework/testing";
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
const CANCEL_DELETION = "user-data-rights:write:cancel-deletion";
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
  await seedRow(stack.db, userTable, {
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

    // Pre-cancel-Replay: zweites Confirm trifft den noch-pending User
    // (DeletionRequested) → der Active-State-Guard schlägt zu → 422. (Den
    // post-cancel-Replay deckt der requestId-Test darunter ab.)
    const second = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(second.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.DeletionRequested);

    // #354/2: der anonyme Endpoint gibt einen generischen reason zurück und
    // leakt NICHT den konkreten User-Status (currentStatus), den ein
    // Token-Inhaber sonst proben könnte.
    const body = (await second.json()) as {
      error: { details?: { reason?: string } };
    };
    expect(body.error.details?.reason).toBe("cannot_process_deletion");
    const serialized = JSON.stringify(body.error);
    expect(serialized).not.toContain("currentStatus");
    expect(serialized).not.toContain(USER_STATUS.DeletionRequested);
  });

  test("replay-after-cancel (#354/1): Token nach cancel-deletion re-armt NICHT → 422, bleibt Active", async () => {
    await seedAlice();
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token = tokenFromLastVerifyCall();

    // 1. Confirm armt die Grace-Period.
    expect(
      (await stack.http.raw("POST", "/api/write", { type: CONFIRM_BY_TOKEN, payload: { token } }))
        .status,
    ).toBe(200);
    expect(await statusOf()).toBe(USER_STATUS.DeletionRequested);

    // 2. User loggt sich (innerhalb der Grace) ein und bricht ab → Active,
    //    pendingDeletionRequestId genullt.
    await stack.http.writeOk(CANCEL_DELETION, {}, aliceUser);
    expect(await statusOf()).toBe(USER_STATUS.Active);

    // 3. Dasselbe, noch TTL-gültige Token nachspielen → die genullte requestId
    //    lässt die HMAC-Purpose nicht mehr aufgehen → 422, kein re-arm.
    const replay = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(replay.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);
  });

  test("supersede (#354/1): altes Token re-armt NICHT, nachdem ein zweiter Antrag eine neue requestId setzt", async () => {
    // Der diskriminierende Fall gegen einen presence-only-Check: nach cancel
    // macht ein FRISCHER Antrag den marker wieder non-null (neue requestId).
    // Ein presence-only-Guard würde das alte Token jetzt fälschlich akzeptieren;
    // der requestId-Match lehnt es ab (token1 trägt R1, Row hält R2).
    await seedAlice();

    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token1 = tokenFromLastVerifyCall();

    await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: token1 },
    });
    await stack.http.writeOk(CANCEL_DELETION, {}, aliceUser);
    expect(await statusOf()).toBe(USER_STATUS.Active);

    // Zweiter Antrag → neue requestId R2 auf der Row + token2.
    verifyCalls.length = 0;
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token2 = tokenFromLastVerifyCall();
    expect(token2).not.toBe(token1);

    // Altes token1 (R1) gegen Row mit R2 → bad_signature → 422, kein re-arm.
    const replayOld = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: token1 },
    });
    expect(replayOld.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);

    // Gegenprobe: das aktuelle token2 (R2) armt regulär.
    const confirmNew = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: token2 },
    });
    expect(confirmNew.status).toBe(200);
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
    // Erst einen echten Antrag stellen, damit eine requestId auf der Row liegt
    // — sonst greift schon der no-outstanding-request-Guard und der Bad-
    // Signature-Pfad würde nie erreicht.
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const { token } = signDeletionToken(
      aliceUser.id,
      "forged-request-id",
      60,
      "the-wrong-secret-totally-different",
    );
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
    await seedRow(bareStack.db, userTable, {
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
    const { token } = signDeletionToken(aliceUser.id, "req-id", 60, DELETION_SECRET);
    const res = await bareStack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(res.status).toBe(422);
  });
});
