// Proves: composeApexAccountApp() boots (full account composition incl.
// auth + user-data-rights) AND the anonymous email-verified deletion flow
// runs end to end through /api/write WITHOUT auth (anonymousAccess).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { tenantComplianceProfileTable } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryTestContext,
  deliveryAttemptsTable,
  notificationPreferencesTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/testing";
import { USER_STATUS, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { composeApexAccountApp } from "../feature";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";
const CONFIRM_BY_TOKEN = "user-data-rights:write:confirm-deletion-by-token";
const SECRET = "recipe-deletion-secret-0123456789";
const VERIFY_URL = "https://app.example.test/delete-account/confirm";

const tenant = testTenantId(1);
const user = createTestUser({ id: 7, tenantId: tenant, roles: ["Member"] });
const EMAIL = "user@example.com";

const transport = createInMemoryTransport();

// The text part carries the plain link; the HTML part is entity-encoded.
function verifyTokenOf(text: string | undefined): string {
  const link = /https?:\/\/\S+#token=[^\s)\]>"]+/.exec(text ?? "")?.[0] ?? "";
  return new URLSearchParams(new URL(link).hash.slice(1)).get("token") ?? "";
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: composeApexAccountApp({
      deletionTokenSecret: SECRET,
      deletionVerifyUrl: VERIFY_URL,
      mailTransport: transport,
    }),
    extraContext: (deps) => createDeliveryTestContext(deps),
    anonymousAccess: { defaultTenantId: tenant },
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedNotificationTemplates(stack.db, stack.registry);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  transport.sent.length = 0;
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
  await seedRowViaEventStore(stack.db, userTable, {
    id: user.id,
    email: EMAIL,
    passwordHash: "hashed",
    displayName: "User",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    gracePeriodEnd: null,
  });
});

describe("apex-surface-auth recipe", () => {
  test("anonymer Deletion-Flow: request-by-email → confirm-by-token → Grace-Period", async () => {
    const reqRes = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: EMAIL },
    });
    expect(reqRes.status).toBe(200);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe(EMAIL);
    expect(transport.sent[0]?.text).toContain(`${VERIFY_URL}#token=`);

    const token = verifyTokenOf(transport.sent[0]?.text);
    expect(token.length).toBeGreaterThan(0);

    const confirmRes = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(confirmRes.status).toBe(200);

    const rows = await selectMany<{ readonly status: string }>(stack.db, userTable, {
      id: user.id,
    });
    expect(rows[0]?.status).toBe(USER_STATUS.DeletionRequested);
  });

  test("enumeration-safe: unknown email → success, no email", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: "nobody@example.com" },
    });
    expect(res.status).toBe(200);
    expect(transport.sent).toHaveLength(0);
  });
});
