// Beweist: composeApexAccountApp() bootet (volle Account-Komposition inkl.
// auth + user-data-rights) UND der anonyme email-verifizierte Deletion-Flow
// läuft end-to-end durch /api/write OHNE Auth (anonymousAccess).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { USER_STATUS, userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import type { SendDeletionVerificationEmailFn } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
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
import { composeApexAccountApp } from "../feature";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";
const CONFIRM_BY_TOKEN = "user-data-rights:write:confirm-deletion-by-token";
const SECRET = "recipe-deletion-secret-0123456789";
const VERIFY_URL = "https://app.example.test/delete-account/confirm";

const tenant = testTenantId(1);
const user = createTestUser({ id: 7, tenantId: tenant, roles: ["Member"] });
const EMAIL = "user@example.com";

const verifyCalls: Parameters<SendDeletionVerificationEmailFn>[0][] = [];
const sendDeletionVerificationEmail: SendDeletionVerificationEmailFn = async (args) => {
  verifyCalls.push(args);
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: composeApexAccountApp({
      deletionTokenSecret: SECRET,
      deletionVerifyUrl: VERIFY_URL,
      sendDeletionVerificationEmail,
    }),
    anonymousAccess: { defaultTenantId: tenant },
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
  await seedRow(stack.db, userTable, {
    id: user.id,
    tenantId: tenant,
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
    expect(verifyCalls).toHaveLength(1);

    const token = new URL(verifyCalls[0]?.verifyUrl ?? "").searchParams.get("token") ?? "";
    expect(token.length).toBeGreaterThan(0);

    const confirmRes = await stack.http.raw("POST", "/api/write", {
      type: CONFIRM_BY_TOKEN,
      payload: { token },
    });
    expect(confirmRes.status).toBe(200);

    const rows = (await selectMany(stack.db, userTable, { id: user.id })) as Array<{
      status: string;
    }>;
    expect(rows[0]?.status).toBe(USER_STATUS.DeletionRequested);
  });

  test("enumeration-safe: unbekannte Email → success, keine Mail", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: REQUEST_BY_EMAIL,
      payload: { email: "nobody@example.com" },
    });
    expect(res.status).toBe(200);
    expect(verifyCalls).toHaveLength(0);
  });
});
