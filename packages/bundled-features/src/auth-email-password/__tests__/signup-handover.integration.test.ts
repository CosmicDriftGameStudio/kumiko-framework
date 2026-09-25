// Cross-device try-first handover, end-to-end (kumiko-framework#3035
// follow-up, offlot-app#454): an anonymous visitor holds a tenant-handover
// grant in one browser, but the magic-link activation may be opened in a
// DIFFERENT browser that never had it. signup-request verifies the grant and
// binds it to the signup token server-side; signup-confirm redeems that
// binding into the freshly provisioned tenant. Spec is this test itself.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  executeRawQuery,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  type EntityDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { signTenantHandoverGrant } from "../../tenant-handover/grant";
import { createTenantHandoverFeature } from "../../tenant-handover/index";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

const GRANT_SECRET = "signup-handover-test-secret-min-32-chars-long-enough";
const CLAIM_QN = "tenant-handover:write:claim";
const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";

const runEntity: EntityDefinition = createEntity({
  table: "signup_handover_run",
  idType: "uuid",
  transferable: true,
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const photoEntity: EntityDefinition = createEntity({
  table: "signup_handover_photo",
  idType: "uuid",
  transferable: true,
  parentRef: { entityTypeField: "hostType", entityIdField: "hostId", allowedTypes: ["run"] },
  fields: {
    hostType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    hostId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    caption: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// Deliberately declares NO `transferable` — models an entity type the claim
// mover must refuse mid-graph (see claim.integration.test.ts's own noteEntity).
const noteEntity: EntityDefinition = createEntity({
  table: "signup_handover_note",
  idType: "uuid",
  parentRef: { entityTypeField: "hostType", entityIdField: "hostId", allowedTypes: ["run"] },
  fields: {
    hostType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    hostId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    body: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

const handoverFixturesFeature = defineFeature("signup-handover-fixtures", (r) => {
  r.entity("run", runEntity);
  r.entity("photo", photoEntity);
  r.entity("note", noteEntity);
});

const runTable = buildEntityTable("run", runEntity);
const photoTable = buildEntityTable("photo", photoEntity);
const noteTable = buildEntityTable("note", noteEntity);
const runCrud = createEventStoreExecutor(runTable, runEntity, { entityName: "run" });
const photoCrud = createEventStoreExecutor(photoTable, photoEntity, { entityName: "photo" });
const noteCrud = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

let stack: TestStack;

const SOURCE_TENANT = testTenantId(3);
let nextUserId = 1;

function firstDeviceUser(tenantN: number) {
  return createTestUser({ id: nextUserId++, tenantId: testTenantId(tenantN), roles: ["User"] });
}

const emailTransport = createInMemoryTransport();

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL },
      }),
      createTenantHandoverFeature({ grantSecret: GRANT_SECRET }),
      handoverFixturesFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, runEntity, "run");
  await unsafeCreateEntityTable(stack.db, photoEntity, "photo");
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, signup_handover_run, signup_handover_photo, signup_handover_note, file_refs RESTART IDENTITY CASCADE`,
  );
  emailTransport.sent.length = 0;
  const allKeys = await stack.redis.redis.keys("signup:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);
});

async function seedRun(tenantId: TenantId, name: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await runCrud.create({ name }, user, db);
  if (!result.isSuccess) throw new Error(`seedRun failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedPhoto(tenantId: TenantId, hostId: string, caption: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await photoCrud.create({ hostType: "run", hostId, caption }, user, db);
  if (!result.isSuccess) throw new Error(`seedPhoto failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedNote(tenantId: TenantId, hostId: string, body: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await noteCrud.create({ hostType: "run", hostId, body }, user, db);
  if (!result.isSuccess) throw new Error(`seedNote failed: ${result.error.message}`);
  return String(result.data.id);
}

// beforeEach empties read_users, so a plain count is enough to prove nothing
// was provisioned — email is encrypted at rest (personal: "self"), so a raw
// WHERE email = $1 wouldn't match the ciphertext anyway.
async function countAllUsers(): Promise<number> {
  const rows = await executeRawQuery<{ count: string }>(
    stack.db,
    `SELECT COUNT(*) AS count FROM "${userTable.tableName}"`,
  );
  return Number(rows[0]?.count ?? "0");
}

function grantFor(runId: string, secret: string = GRANT_SECRET): string {
  return signTenantHandoverGrant({
    entityType: "run",
    rowId: runId,
    sourceTenantId: SOURCE_TENANT,
    ttlMinutes: 30,
    secret,
  }).token;
}

async function readTenantId(table: string, id: string): Promise<string | undefined> {
  const rows = await executeRawQuery<{ tenantId: string }>(
    stack.db,
    `SELECT tenant_id AS "tenantId" FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.tenantId;
}

async function postSignupRequest(
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-request", body, headers);
}

async function postSignupConfirm(token: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-confirm", { token, password });
}

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in mail html: ${html.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

async function requestSignupAndCaptureToken(body: unknown): Promise<string> {
  emailTransport.sent.length = 0;
  const res = await postSignupRequest(body);
  expect(res.status).toBe(200);
  const sent = emailTransport.sent[0];
  if (!sent) throw new Error("signup-request fixture didn't send mail");
  return extractTokenFromMail(sent.html);
}

describe("cross-device try-first handover :: signup-request + signup-confirm", () => {
  test("(a) grant bound at request time is claimed on confirm even without the grant or the anonymous cookie present", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const photoId = await seedPhoto(SOURCE_TENANT, runId, "front");

    const email = "handover-a@example.com";
    const signupToken = await requestSignupAndCaptureToken({
      email,
      handover: { entityType: "run", token: grantFor(runId) },
    });

    // Confirm carries NO handover/grant of its own — this is the
    // different-browser leg of the flow.
    const confirmRes = await postSignupConfirm(signupToken, "fresh-secure-pw-1234");
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as {
      user?: { id: string; tenantId: string };
      handover?: { entityType: string; id: string };
    };
    const destinationTenantId = body.user?.tenantId;
    if (!destinationTenantId) throw new Error("confirm did not return a tenantId");

    expect(body.handover).toEqual({ entityType: "run", id: runId });
    expect(await readTenantId("signup_handover_run", runId)).toBe(destinationTenantId);
    expect(await readTenantId("signup_handover_photo", photoId)).toBe(destinationTenantId);

    const auditEvents = await executeRawQuery<{ payload: Record<string, unknown> }>(
      stack.db,
      `SELECT payload FROM kumiko_events WHERE type = 'tenant-handover:event:claimed' AND tenant_id = $1`,
      [destinationTenantId],
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.payload).toMatchObject({
      entityType: "run",
      rootRowId: runId,
      sourceTenantId: SOURCE_TENANT,
      destinationTenantId,
    });
  });

  test("(b) a grant already claimed by another device before confirm does not fail the signup and leaves the data with the first claimer", async () => {
    const runId = await seedRun(SOURCE_TENANT, "someone else's run");
    const email = "handover-b@example.com";
    const signupToken = await requestSignupAndCaptureToken({
      email,
      handover: { entityType: "run", token: grantFor(runId) },
    });

    // First device: a different, already-logged-in user claims the SAME
    // grant via the regular tenant-handover write before confirm runs.
    const firstClaimer = firstDeviceUser(9);
    const firstClaim = await stack.http.writeOk<{ destinationTenantId: string }>(
      CLAIM_QN,
      { token: grantFor(runId), entityType: "run" },
      firstClaimer,
    );
    expect(firstClaim.destinationTenantId).toBe(firstClaimer.tenantId);

    const confirmRes = await postSignupConfirm(signupToken, "fresh-secure-pw-1234");
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as {
      isSuccess: boolean;
      token?: string;
      user?: { id: string; tenantId: string };
      handover?: { entityType: string; id: string };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.handover).toBeUndefined();

    // Account/login for the signup still works — a failed claim redeem
    // must never fail the signup itself.
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email,
      password: "fresh-secure-pw-1234",
    });
    expect(loginRes.status).toBe(200);

    // Data stayed with the first claimer, not the new signup tenant.
    expect(await readTenantId("signup_handover_run", runId)).toBe(firstClaimer.tenantId);
    if (body.user?.tenantId) {
      expect(await readTenantId("signup_handover_run", runId)).not.toBe(body.user.tenantId);
    }
  });

  test("(c) a forged grant (wrong secret) verifies to nothing — request and confirm both stay 200, nothing moves", async () => {
    const runId = await seedRun(SOURCE_TENANT, "forged-target run");
    const email = "handover-c@example.com";
    const forgedToken = grantFor(runId, "wrong-secret-min-32-chars-long-enough!!");

    const signupToken = await requestSignupAndCaptureToken({
      email,
      handover: { entityType: "run", token: forgedToken },
    });

    const confirmRes = await postSignupConfirm(signupToken, "fresh-secure-pw-1234");
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as { handover?: unknown };
    expect(body.handover).toBeUndefined();
    expect(await readTenantId("signup_handover_run", runId)).toBe(SOURCE_TENANT);
  });

  test("(d) resend without a fresh grant carries the earlier verified binding to the NEW token; the old token stops working", async () => {
    const runId = await seedRun(SOURCE_TENANT, "resend-target run");
    const email = "handover-d@example.com";

    const firstSignupToken = await requestSignupAndCaptureToken({
      email,
      handover: { entityType: "run", token: grantFor(runId) },
    });
    // Resend WITHOUT a handover in the payload — the visitor just retyped
    // their email, the earlier verified grant must carry over.
    const secondSignupToken = await requestSignupAndCaptureToken({ email });
    expect(secondSignupToken).not.toBe(firstSignupToken);

    const oldConfirm = await postSignupConfirm(firstSignupToken, "irrelevant-pw-1234");
    expect(oldConfirm.status).toBe(422);

    const newConfirm = await postSignupConfirm(secondSignupToken, "fresh-secure-pw-1234");
    expect(newConfirm.status).toBe(200);
    const body = (await newConfirm.json()) as {
      user?: { tenantId: string };
      handover?: { entityType: string; id: string };
    };
    expect(body.handover).toEqual({ entityType: "run", id: runId });
    expect(await readTenantId("signup_handover_run", runId)).toBe(body.user?.tenantId);
  });

  test("(e) the signup-request response body never contains the grant token", async () => {
    const runId = await seedRun(SOURCE_TENANT, "leak-check run");
    const grantToken = grantFor(runId);
    const res = await postSignupRequest({
      email: "handover-e@example.com",
      handover: { entityType: "run", token: grantToken },
    });
    expect(res.status).toBe(200);
    const rawBody = await res.text();
    expect(rawBody).not.toContain(grantToken);
  });

  test("(f) a claim that would leave a non-transferable child behind fails the signup instead of committing a partial move", async () => {
    const runId = await seedRun(SOURCE_TENANT, "graph-guard run");
    await seedNote(SOURCE_TENANT, runId, "undeclared child");
    const email = "handover-f@example.com";
    const signupToken = await requestSignupAndCaptureToken({
      email,
      handover: { entityType: "run", token: grantFor(runId) },
    });

    const confirmRes = await postSignupConfirm(signupToken, "fresh-secure-pw-1234");
    expect(confirmRes.status).not.toBe(200);
    expect(confirmRes.status).toBe(422);
    const body = (await confirmRes.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("entity_not_transferable");

    expect(await countAllUsers()).toBe(0);
    expect(await readTenantId("signup_handover_run", runId)).toBe(SOURCE_TENANT);

    // The activation link stays retryable — same error again, not a dead
    // invalid_signup_token, because the failure aborted before the token
    // was burned/deleted.
    const retryRes = await postSignupConfirm(signupToken, "fresh-secure-pw-1234");
    expect(retryRes.status).toBe(422);
    const retryBody = (await retryRes.json()) as { error?: { details?: { reason?: string } } };
    expect(retryBody.error?.details?.reason).toBe("entity_not_transferable");
  });
});
