// Anonymous, email-verified deletion flow (apex, lockout-safe).
//
// Step 1 (request-deletion-by-email): anonymous and enumeration-safe; signs an
// HMAC token and invokes the verification-email callback. Step 2
// (confirm-deletion-by-token): anonymous; verifies the token and starts the
// grace period.
// Exercises the complete flow through real /api/write calls without auth
// (anonymousAccess).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { UNKNOWN_CLIENT_IP } from "@cosmicdrift/kumiko-framework/api";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId, testUserId } from "@cosmicdrift/kumiko-framework/seeding";
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
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { signDeletionToken } from "../deletion-token.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import type { SendDeletionVerificationEmailFn } from "../handlers/request-deletion-by-email.write.ts";

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
      createAuthFoundationFeature(),
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
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  verifyCalls.length = 0;
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
  // request-deletion-by-email/confirm-deletion-by-token are `per: "ip"`
  // rate-limited (10/60s). All calls here go through stack.http.raw with no
  // socket address, so every test in this file lands in the same shared
  // "unknown" IP bucket — flush it per test so one test's calls can't push
  // a later, unrelated test over the cap.
  await stack.redis.flushNamespace();
});

async function seedAlice(
  status: string = USER_STATUS.Active,
  email: string = ALICE_EMAIL,
  id: string = aliceUser.id,
) {
  await seedRow(stack.db, userTable, {
    id,
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

// stack.http.raw has no socket address, so every call lands in the "unknown"
// IP bucket of its handler (see rate-limit/bucket.ts). The client carries the
// per-stack key prefix.
async function resetUnknownIpRateLimitBuckets(): Promise<void> {
  await stack.redis.redis.del(
    `kumiko:rl:ip+handler:${UNKNOWN_CLIENT_IP}:${REQUEST_BY_EMAIL}`,
    `kumiko:rl:ip+handler:${UNKNOWN_CLIENT_IP}:${CONFIRM_BY_TOKEN}`,
  );
}

function tokenFromLastVerifyCall(email?: string): string {
  const call = email === undefined ? verifyCalls[0] : verifyCalls.find((c) => c.email === email);
  const url = new URL(call?.verifyUrl ?? "");
  return new URLSearchParams(url.hash.slice(1)).get("token") ?? "";
}

async function statusOf(id: string = aliceUser.id): Promise<string | undefined> {
  const rows = (await selectMany(stack.db, userTable, { id })) as Array<{
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
    expect(verifyCalls[0]?.verifyUrl.startsWith(`${VERIFY_URL}#token=`)).toBe(true);
    expect(tokenFromLastVerifyCall().length).toBeGreaterThan(0);
    // Status remains unchanged until confirm starts the grace period.
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

    // Pre-cancel replay: the second confirmation reaches the still-pending user
    // (DeletionRequested), so the Active-state guard rejects it with 422. The
    // requestId test below covers post-cancel replay.
    const second = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(second.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.DeletionRequested);

    // The anonymous endpoint returns the same generic reason
    // for EVERY error path as an invalid token — since the grace-period
    // transition now lives inside commitDeletion (the anchor spend), there is
    // no separate res.ok branch left that could leak the concrete user status
    // (currentStatus).
    const body = (await second.json()) as {
      error: { details?: { reason?: string } };
    };
    expect(body.error.details?.reason).toBe("invalid_or_expired_token");
    const serialized = JSON.stringify(body.error);
    expect(serialized).not.toContain("currentStatus");
    expect(serialized).not.toContain(USER_STATUS.DeletionRequested);
  });

  test("concurrent confirm-by-token: two simultaneous redemptions of the same token leave exactly one winner", async () => {
    // Real concurrency case, real HTTP calls via setupTestStack, no sleep —
    // the interleaving width varies between runs, hence 20 repetitions
    // instead of a single run (probabilistic test).
    for (let i = 0; i < 20; i++) {
      // A fresh user per iteration instead of truncating the tables: the
      // per-iteration TRUNCATE dominated the runtime and pushed the loop past
      // the test timeout under parallel load.
      const iterationId = testUserId(1000 + i);
      const iterationEmail = `alice.concurrent.${i}@example.com`;
      // Both handlers below are `per: "ip"` rate-limited (10/60s); this loop's
      // own 3 calls/iteration would otherwise trip that limiter well before
      // the 20th repetition, which has nothing to do with the concurrency
      // behaviour under test. Deleting the two buckets directly instead of
      // flushNamespace: that SCANs the whole shared Redis keyspace, which cost
      // hundreds of ms per iteration and blew the test timeout under parallel load.
      await resetUnknownIpRateLimitBuckets();
      await seedAlice(USER_STATUS.Active, iterationEmail, iterationId);
      await stack.http.raw("POST", "/api/write", {
        type: REQUEST_BY_EMAIL,
        payload: { email: iterationEmail },
      });
      const token = tokenFromLastVerifyCall(iterationEmail);

      const [first, second] = await Promise.all([
        stack.http.raw("POST", "/api/write", { type: CONFIRM_BY_TOKEN, payload: { token } }),
        stack.http.raw("POST", "/api/write", { type: CONFIRM_BY_TOKEN, payload: { token } }),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 422]);
      // Exactly ONE lifecycle transition: the row lands at DeletionRequested,
      // not in a last-write-wins in-between state from two applied writes.
      expect(await statusOf(iterationId)).toBe(USER_STATUS.DeletionRequested);

      const loser = first.status === 422 ? first : second;
      const body = (await loser.json()) as { error: { details?: { reason?: string } } };
      expect(body.error.details?.reason).toBe("invalid_or_expired_token");
      const serialized = JSON.stringify(body.error);
      expect(serialized).not.toContain("currentStatus");
      expect(serialized).not.toContain(USER_STATUS.DeletionRequested);
    }
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

    // 2. The user logs in during the grace period and cancels → Active;
    //    pendingDeletionRequestId is cleared.
    await stack.http.writeOk(CANCEL_DELETION, {}, aliceUser);
    expect(await statusOf()).toBe(USER_STATUS.Active);

    // 3. Replaying the same token while it is still valid under its TTL cannot
    //    satisfy the HMAC purpose after requestId was cleared → 422, no re-arm.
    const replay = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(replay.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);
  });

  test("supersede (#354/1): altes Token re-armt NICHT, nachdem ein zweiter Antrag eine neue requestId setzt", async () => {
    // This distinguishes the requestId check from a presence-only check: after
    //    cancel, a fresh request sets the marker again with a new requestId.
    // A presence-only guard would incorrectly accept the old token; the
    // requestId match rejects it (token1 carries R1, while the row holds R2).
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

    // A second request assigns requestId R2 to the row and produces token2.
    verifyCalls.length = 0;
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token2 = tokenFromLastVerifyCall();
    expect(token2).not.toBe(token1);

    // The old token1 (R1) is checked against a row containing R2 →
    // bad_signature → 422, with no re-arm.
    const replayOld = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: token1 },
    });
    expect(replayOld.status).toBe(422);
    expect(await statusOf()).toBe(USER_STATUS.Active);

    // Control case: the current token2 (R2) arms the grace period normally.
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
    // First create a genuine request so the row has a requestId; otherwise the
    // no-outstanding-request guard would reject the call before reaching the
    // bad-signature path.
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
        createAuthFoundationFeature(),
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
