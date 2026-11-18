// A user without a stored locale gets the GDPR mail in the language of the request
// and under the app name, the same way the auth mails of the app resolve them.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
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
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable } from "../../delivery/tables.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { deletionMailFeatures, prepareDeletionMailStack } from "./deletion-mail-stack.ts";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";
const TENANT_ID = "00000000-0000-4000-8000-0000000007a1";
const USER_ID = "00000000-0000-4000-8000-0000000007b1";
const EMAIL = "no-locale@example.test";
const APP_NAME = "Acme Hausverwaltung";

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
        deletionTokenSecret: "mail-request-locale-secret-0123456789abcdef",
        deletionVerifyUrl: "https://app.example.test/delete-account/confirm",
        mailDefaults: { appName: APP_NAME, locale: "de" },
      }),
      ...deletionMailFeatures(transport),
      localeDe(),
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
    anonymousAccess: { defaultTenantId: TENANT_ID },
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
  await resetTestTables(stack.db, [userTable, eventsTable, deliveryAttemptsTable]);
  await stack.redis.flushNamespace();
});

async function requestDeletionMailSubject(acceptLanguage: string): Promise<string | undefined> {
  await seedRowViaEventStore(stack.db, userTable, {
    id: USER_ID,
    email: EMAIL,
    passwordHash: "hashed",
    displayName: "No Locale",
    locale: null,
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    gracePeriodEnd: null,
  });

  const res = await stack.http.raw(
    "POST",
    "/api/write",
    { type: REQUEST_BY_EMAIL, payload: { email: EMAIL } },
    { "Accept-Language": acceptLanguage },
  );
  expect(res.status).toBe(200);
  expect(transport.sent).toHaveLength(1);
  return transport.sent[0]?.subject;
}

describe("GDPR mail locale and app name", () => {
  test("a user without stored locale gets the verify mail in the request language under the app name", async () => {
    expect(await requestDeletionMailSubject("de-DE,de;q=0.9,en;q=0.5")).toBe(
      `${APP_NAME} — Kontolöschung bestätigen`,
    );
  });

  test("a request language with mail translations wins over mailDefaults.locale", async () => {
    expect(await requestDeletionMailSubject("en-US,en;q=0.9")).toBe(
      `${APP_NAME} — Confirm your account deletion`,
    );
  });

  // Accept-Language is only checked for well-formedness; a tag without mail
  // translations must not push a German app's mail into the English fallback.
  test("a request language without mail translations falls back to mailDefaults.locale", async () => {
    expect(await requestDeletionMailSubject("pl-PL,de;q=0.8")).toBe(
      `${APP_NAME} — Kontolöschung bestätigen`,
    );
  });
});
