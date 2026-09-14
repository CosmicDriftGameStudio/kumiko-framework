import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { buildAppSchema, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature";
import { authFoundationFeature } from "../auth-foundation";
import { createAuthMfaFeature } from "../auth-mfa";
import { userMfaEntity } from "../auth-mfa/schema/user-mfa";
import { createConfigFeature } from "../config";
import { createConfigResolver } from "../config/resolver";
import { configValuesTable } from "../config/table";
import { createSessionsFeature } from "../sessions";
import { makeSessionHelpers } from "../sessions/__tests__/test-helpers";
import { userSessionEntity } from "../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../sessions/session-callbacks";
import { sessionCallbacksFromLateBound } from "../sessions/testing";
import { createTenantFeature } from "../tenant";
import { tenantMembershipsTable } from "../tenant/membership-table";
import { tenantEntity } from "../tenant/schema/tenant";
import { createUserFeature } from "../user/feature";
import { userEntity } from "../user/schema/user";
import {
  ACCOUNT_SECURITY_SCREEN_ID,
  accountSecurityFeature,
  mfaStatusVisibility,
  testAuthMfaOptions,
} from "./account-security-fixture";

type PanelQueryRow = { readonly id: string; readonly current: boolean };

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
const TENANT: TenantId = testTenantId(1);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const bound = sessionCallbacksFromLateBound(callbacks);
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createAuthMfaFeature(testAuthMfaOptions),
      accountSecurityFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  h = makeSessionHelpers(stack, TENANT, bound.asAuthConfig().sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
  configureEntityFieldEncryption(undefined);
});

function accountSecurityScreenPanels() {
  const app = buildAppSchema(stack.registry);
  const screen = app.features
    .find((f) => f.featureName === "account-security")
    ?.screens.find((s) => s.id === ACCOUNT_SECURITY_SCREEN_ID);
  if (screen?.type !== "dashboard") throw new Error("expected the account-security dashboard");
  return screen.panels;
}

function embeddedScreen(qn: string) {
  const [featureName, , screenId] = qn.split(":");
  const screen = buildAppSchema(stack.registry)
    .features.find((f) => f.featureName === featureName)
    ?.screens.find((s) => s.id === screenId);
  if (screen === undefined) throw new Error(`embedded screen ${qn} missing from app schema`);
  return screen;
}

describe("account-security dashboard on a real stack", () => {
  test("ships its screen panels in the client app schema, each resolving to a wired screen", () => {
    const panels = accountSecurityScreenPanels();
    const targets = panels.flatMap((p) => (p.kind === "screen" ? [p.screen] : []));
    expect(targets).toEqual([
      "auth-mfa:screen:auth-mfa-enable",
      "auth-mfa:screen:auth-mfa-regenerate-recovery",
      "auth-mfa:screen:auth-mfa-disable",
      "sessions:screen:my-sessions",
    ]);
    for (const qn of targets)
      expect(embeddedScreen(qn).access).toEqual({
        openToAll: { reason: "test handler callable by any signed-in test user" },
      });
  });

  test("a plain User gets the flat visibleWhen record and their own sessions over HTTP", async () => {
    await h.seedUser("dash@example.com", "pw-long-enough");
    const other = await h.login("dash@example.com", "pw-long-enough");
    const current = await h.login("dash@example.com", "pw-long-enough");

    const statusRes = await h.authedPost("/api/query", current.token, {
      type: mfaStatusVisibility.query,
      payload: {},
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { data: Record<string, unknown> };
    expect(status.data[mfaStatusVisibility.field]).toBe(false);

    const sessionsScreen = embeddedScreen("sessions:screen:my-sessions");
    if (sessionsScreen.type !== "projectionList") throw new Error("expected a projectionList");
    const listRes = await h.authedPost("/api/query", current.token, {
      type: sessionsScreen.query,
      payload: { limit: 50 },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: { rows: PanelQueryRow[] } };
    expect(list.data.rows.map((r) => r.id).sort()).toEqual([current.sid, other.sid].sort());
    expect(list.data.rows.find((r) => r.current)?.id).toBe(current.sid);
  });

  test("the embedded list's revoke-all-others toolbar action leaves only the current session", async () => {
    await h.seedUser("dash-revoke@example.com", "pw-long-enough");
    await h.login("dash-revoke@example.com", "pw-long-enough");
    const current = await h.login("dash-revoke@example.com", "pw-long-enough");

    const sessionsScreen = embeddedScreen("sessions:screen:my-sessions");
    if (sessionsScreen.type !== "projectionList") throw new Error("expected a projectionList");
    const action = sessionsScreen.toolbarActions?.find((a) => a.id === "revoke-all-others");
    if (action?.kind !== "writeHandler") throw new Error("expected a writeHandler toolbar action");

    const revokeRes = await h.authedPost("/api/write", current.token, {
      type: action.handler,
      payload: action.payload ?? {},
    });
    expect(revokeRes.status).toBe(200);

    const listRes = await h.authedPost("/api/query", current.token, {
      type: sessionsScreen.query,
      payload: {},
    });
    const list = (await listRes.json()) as { data: { rows: PanelQueryRow[] } };
    expect(list.data.rows.map((r) => r.id)).toEqual([current.sid]);
  });
});
