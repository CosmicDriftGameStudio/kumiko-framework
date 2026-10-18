import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { buildAppSchema, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  ACCOUNT_SECURITY_SCREEN_ID,
  accountSecurityMfaStatusVisibility,
  createAccountSecurityFeature,
} from "../account-security/index.js";
import { AuthHandlers } from "../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature.js";
import { createAuthFoundationFeature } from "../auth-foundation/index.js";
import { base32Decode } from "../auth-mfa/base32.js";
import { AuthMfaHandlers, createAuthMfaFeature } from "../auth-mfa/index.js";
import { userMfaEntity } from "../auth-mfa/schema/user-mfa.js";
import { currentTotpCode } from "../auth-mfa/totp.js";
import { createConfigFeature } from "../config/index.js";
import { createConfigResolver } from "../config/resolver.js";
import { configValuesTable } from "../config/table.js";
import { makeSessionHelpers } from "../sessions/__tests__/test-helpers.js";
import { createSessionsFeature } from "../sessions/index.js";
import { userSessionEntity } from "../sessions/schema/user-session.js";
import { createSessionCallbacks, type SessionCallbacks } from "../sessions/session-callbacks.js";
import { sessionCallbacksFromLateBound } from "../sessions/testing.js";
import { createTenantFeature } from "../tenant/index.js";
import { tenantMembershipsTable } from "../tenant/membership-table.js";
import { tenantEntity } from "../tenant/schema/tenant.js";
import { createUserFeature } from "../user/feature.js";
import { userEntity } from "../user/schema/user.js";
import { testAuthMfaOptions } from "./auth-mfa-test-options.js";

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
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthMfaFeature(testAuthMfaOptions),
      createAccountSecurityFeature(),
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
    const expectedReasons: ReadonlyArray<{ readonly qn: string; readonly reason: string }> = [
      {
        qn: "auth-mfa:screen:auth-mfa-enable",
        reason:
          "each signed-in user may enroll their own account in MFA, mirroring the enable-start handler",
      },
      {
        qn: "auth-mfa:screen:auth-mfa-regenerate-recovery",
        reason:
          "each signed-in user may regenerate their own recovery codes, mirroring the regenerate-recovery handler",
      },
      {
        qn: "auth-mfa:screen:auth-mfa-disable",
        reason: "each signed-in user may turn off their own MFA, mirroring the disable handler",
      },
      {
        qn: "sessions:screen:my-sessions",
        reason:
          "each signed-in user views and revokes only their own sessions, mirroring the mine/revoke handlers",
      },
    ];
    for (const { qn, reason } of expectedReasons)
      expect(embeddedScreen(qn).access).toEqual({ openToAll: { reason } });
  });

  test("a plain User gets the flat visibleWhen record and their own sessions over HTTP", async () => {
    await h.seedUser("dash@example.com", "pw-long-enough");
    const other = await h.login("dash@example.com", "pw-long-enough");
    const current = await h.login("dash@example.com", "pw-long-enough");

    const statusRes = await h.authedPost("/api/query", current.token, {
      type: accountSecurityMfaStatusVisibility.query,
      payload: {},
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { data: Record<string, unknown> };
    expect(status.data[accountSecurityMfaStatusVisibility.field]).toBe(false);

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
  test("enabling MFA through the embedded handlers flips the panel visibility query", async () => {
    await h.seedUser("dash-mfa@example.com", "pw-long-enough");
    const current = await h.login("dash-mfa@example.com", "pw-long-enough");

    const startRes = await h.authedPost("/api/write", current.token, {
      type: AuthMfaHandlers.enableStart,
      payload: { accountLabel: "dash-mfa@example.com" },
    });
    expect(startRes.status).toBe(200);
    const start = (await startRes.json()) as {
      data: { setupToken: string; otpauthUri: string };
    };
    const secretParam =
      new URLSearchParams(start.data.otpauthUri.split("?")[1]).get("secret") ?? "";
    const confirmRes = await h.authedPost("/api/write", current.token, {
      type: AuthMfaHandlers.enableConfirm,
      payload: {
        setupToken: start.data.setupToken,
        code: currentTotpCode(base32Decode(secretParam)),
      },
    });
    expect(confirmRes.status).toBe(200);

    const statusRes = await h.authedPost("/api/query", current.token, {
      type: accountSecurityMfaStatusVisibility.query,
      payload: {},
    });
    const status = (await statusRes.json()) as { data: Record<string, unknown> };
    expect(status.data[accountSecurityMfaStatusVisibility.field]).toBe(true);
    const visibleAfterEnable = accountSecurityScreenPanels()
      .filter(
        (p) =>
          p.kind === "screen" &&
          (p.visibleWhen === undefined || ("eq" in p.visibleWhen && p.visibleWhen.eq === true)),
      )
      .map((p) => p.id);
    expect(visibleAfterEnable).toEqual(["mfa-regenerate", "mfa-disable", "sessions"]);
  });
});
