// A deletionRequested account fails the login gate, so the cancel link in the
// deletion-requested mail is the only way back. Real /api/write calls without a
// session (anonymousAccess); the verify mail is captured at the in-memory
// transport, the deletion-requested mail through the app callback.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createInMemoryTransport } from "../../channel-email/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable } from "../../delivery/tables.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { signDeletionCancelToken } from "../deletion-token.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write.ts";
import { UserDataRightsHandlers } from "../web/constants.ts";
import {
  deletionMailFeatures,
  prepareDeletionMailStack,
  verifyTokenFromMail,
} from "./deletion-mail-stack.ts";

const REQUEST_DELETION = UserDataRightsHandlers.requestDeletion;
const REQUEST_BY_EMAIL = UserDataRightsHandlers.requestDeletionByEmail;
const CONFIRM_BY_TOKEN = UserDataRightsHandlers.confirmDeletionByToken;
const CANCEL_BY_TOKEN = UserDataRightsHandlers.cancelDeletionByToken;
const DELETION_SECRET = "cancel-token-test-secret-0123456789abcdef";
const VERIFY_URL = "https://app.example.test/delete-account/confirm";
const CANCEL_URL = "https://app.example.test/delete-account/cancel";

const tenantA = testTenantId(1);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const ALICE_EMAIL = "alice.cancel@example.com";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

type RequestedMailArgs = Parameters<SendDeletionRequestedEmailFn>[0];
const requestedMails: RequestedMailArgs[] = [];
const transport = createInMemoryTransport();

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
        deletionCancelUrl: CANCEL_URL,
        sendDeletionRequestedEmail: async (args) => {
          requestedMails.push(args);
        },
      }),
      ...deletionMailFeatures(transport),
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
    anonymousAccess: { defaultTenantId: tenantA },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await prepareDeletionMailStack(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  requestedMails.length = 0;
  transport.sent.length = 0;
  await resetTestTables(stack.db, [
    userTable,
    tenantComplianceProfileTable,
    eventsTable,
    deliveryAttemptsTable,
  ]);
  // Anonymous calls via stack.http.raw share one "unknown" IP bucket per handler.
  await stack.redis.flushNamespace();
});

async function seedAlice(
  status: string = USER_STATUS.Active,
  gracePeriodEnd: Instant | null = null,
): Promise<void> {
  await seedRowViaEventStore(stack.db, userTable, {
    id: aliceUser.id,
    email: ALICE_EMAIL,
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status,
    gracePeriodEnd,
  });
}

async function aliceRow(): Promise<{ status: string; gracePeriodEnd: Instant | null }> {
  const rows = (await selectMany(stack.db, userTable, { id: aliceUser.id })) as Array<{
    status: string;
    gracePeriodEnd: Instant | null;
  }>;
  const row = rows[0];
  if (!row) throw new Error("alice row missing");
  return row;
}

function tokenOf(url: string): string {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
}

function verifyTokenOfFirstMail(): string {
  const mail = transport.sent.find((m) => m.to === ALICE_EMAIL);
  if (!mail) throw new Error(`no verify mail sent to ${ALICE_EMAIL}`);
  return verifyTokenFromMail(mail, VERIFY_URL);
}

function cancelUrlOfOnlyMail(): string {
  expect(requestedMails).toHaveLength(1);
  const url = requestedMails[0]?.cancelUrl;
  if (url === undefined) throw new Error("mail has no cancelUrl");
  return url;
}

async function cancelByToken(token: string): Promise<Response> {
  return stack.http.raw("POST", "/api/write", { type: CANCEL_BY_TOKEN, payload: { token } });
}

async function expectGenericInvalid(res: Response): Promise<void> {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: { details?: { reason?: string } } };
  expect(body.error.details?.reason).toBe("invalid_or_expired_token");
  expect(JSON.stringify(body.error)).not.toContain("currentStatus");
}

describe("cancel-deletion-by-token", () => {
  test("session-requested deletion: mail carries the cancel link, the token restores the account, replay → 422", async () => {
    await seedAlice();
    await stack.http.writeOk(REQUEST_DELETION, {}, aliceUser);
    expect((await aliceRow()).status).toBe(USER_STATUS.DeletionRequested);

    const url = cancelUrlOfOnlyMail();
    expect(url.startsWith(`${CANCEL_URL}#token=`)).toBe(true);
    const token = tokenOf(url);

    const res = await cancelByToken(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; data: Record<string, unknown> };
    expect(body.isSuccess).toBe(true);
    expect(body.data).toEqual({ status: USER_STATUS.Active });
    const row = await aliceRow();
    expect(row.status).toBe(USER_STATUS.Active);
    expect(row.gracePeriodEnd).toBeNull();

    await expectGenericInvalid(await cancelByToken(token));
  });

  test("anonymous confirm path also mails the cancel link, and the token cancels", async () => {
    await seedAlice();
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const confirm = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token: verifyTokenOfFirstMail() },
    });
    expect(confirm.status).toBe(200);
    expect((await aliceRow()).status).toBe(USER_STATUS.DeletionRequested);

    const res = await cancelByToken(tokenOf(cancelUrlOfOnlyMail()));
    expect(res.status).toBe(200);
    expect((await aliceRow()).status).toBe(USER_STATUS.Active);
  });

  test("manipulated token → generic 422, deletion stays pending", async () => {
    await seedAlice();
    await stack.http.writeOk(REQUEST_DELETION, {}, aliceUser);
    const token = tokenOf(cancelUrlOfOnlyMail());
    const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;

    await expectGenericInvalid(await cancelByToken(tampered));
    await expectGenericInvalid(await cancelByToken("not-a-token"));
    expect((await aliceRow()).status).toBe(USER_STATUS.DeletionRequested);
  });

  test("a deletion-request token does not work as a cancel token", async () => {
    await seedAlice();
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    await expectGenericInvalid(await cancelByToken(verifyTokenOfFirstMail()));
  });

  test("grace period already over → generic 422, nothing changes", async () => {
    const T = getTemporal();
    const expiredEnd = T.Instant.fromEpochMilliseconds(Date.now() - 60_000);
    await seedAlice(USER_STATUS.DeletionRequested, expiredEnd);
    // TTL floors at one minute, so the signature is still valid: the grace-period
    // check itself has to reject.
    const { token } = signDeletionCancelToken(aliceUser.id, expiredEnd, DELETION_SECRET);

    await expectGenericInvalid(await cancelByToken(token));
    expect((await aliceRow()).status).toBe(USER_STATUS.DeletionRequested);
  });

  test("token for an account without a pending deletion → generic 422", async () => {
    await seedAlice();
    const T = getTemporal();
    const { token } = signDeletionCancelToken(
      aliceUser.id,
      T.Instant.fromEpochMilliseconds(Date.now() + 86_400_000),
      DELETION_SECRET,
    );

    await expectGenericInvalid(await cancelByToken(token));
    expect((await aliceRow()).status).toBe(USER_STATUS.Active);
  });
});
