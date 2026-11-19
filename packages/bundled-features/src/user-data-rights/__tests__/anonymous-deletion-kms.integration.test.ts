// Anonymous deletion flow with active PII KMS and blind index:
// the user row is encrypted in the database. request-deletion-by-email must
// find the user through the email_bidx column and send the verification email
// to the plaintext address (previously, the ciphertext address made delivery fail).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
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
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { seedUser } from "../../user/seeding.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import {
  deletionMailFeatures,
  prepareDeletionMailStack,
  verifyTokenFromMail,
} from "./deletion-mail-stack.ts";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";
const CONFIRM_BY_TOKEN = "user-data-rights:write:confirm-deletion-by-token";
const DELETION_SECRET = "test-deletion-secret-0123456789abcdef";
const VERIFY_URL = "https://app.example.test/delete-account/confirm";
const ALICE_EMAIL = "alice.kms-deletion@example.com";
const BIDX_KEY = Buffer.alloc(32, 7).toString("base64");

const tenantA = testTenantId(1);

const transport = createInMemoryTransport();

let stack: TestStack;
let aliceId: string;

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
        mailDefaults: { appName: "Acme" },
      }),
      ...deletionMailFeatures(transport),
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
    anonymousAccess: { defaultTenantId: tenantA },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await prepareDeletionMailStack(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  transport.sent.length = 0;
  await resetTestTables(stack.db, [
    userTable,
    tenantComplianceProfileTable,
    eventsTable,
    deliveryAttemptsTable,
  ]);

  // Configure KMS and the blind-index key before seeding because seedUser runs
  // through the executor and the row must represent the encrypted production state.
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(BIDX_KEY);
  ({ id: aliceId } = await seedUser(stack.db, {
    email: ALICE_EMAIL,
    displayName: "Alice",
    passwordHash: "hashed",
    emailVerified: true,
  }));
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

function tokenFromLastVerifyCall(): string {
  const mail = transport.sent.find((m) => m.to === ALICE_EMAIL);
  if (!mail) throw new Error(`no verify mail sent to ${ALICE_EMAIL}`);
  return verifyTokenFromMail(mail, VERIFY_URL);
}

describe("anonymous deletion flow with active KMS", () => {
  test("request-by-email finds the encrypted row via bidx and mails the PLAINTEXT address", async () => {
    const rows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      `SELECT email, email_bidx FROM "${userTable.tableName}" WHERE id = $1`,
      [aliceId],
    );
    expect(isPiiCiphertext(rows[0]?.["email"])).toBe(true);
    expect(String(rows[0]?.["email_bidx"])).toStartWith("kumiko-bidx:v1:");

    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    expect(res.status).toBe(200);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe(ALICE_EMAIL);
    expect(tokenFromLastVerifyCall().length).toBeGreaterThan(0);
  });

  test("confirm-by-token flips to DeletionRequested; response carries no ciphertext", async () => {
    await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: ALICE_EMAIL },
    });
    const token = tokenFromLastVerifyCall();
    expect(token).not.toBe("");

    const res = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("kumiko-pii:");
    const body = JSON.parse(bodyText) as { data?: { status?: string } };
    expect(body.data?.status).toBe(USER_STATUS.DeletionRequested);
  });
});
