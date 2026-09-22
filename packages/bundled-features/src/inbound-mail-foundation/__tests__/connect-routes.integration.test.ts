// Connect-routes integration — mounts createInboundMailConnectRoutes as
// real extraRoutes on a setupTestStack (kumiko-framework#3050), driven with
// real HTTP through the framework's own auth/signature wiring, never a
// hand-rolled Hono app or createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory";
import { createSecretsContext, createSecretsFeature, tenantSecretsTable } from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  createInboundMailConnectRoutes,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  type InboundMailProviderPlugin,
  inboundCredentialSecretKey,
  inboundMailFoundationFeature,
  mailAccountsProjectionTable,
  type OAuthTokenSet,
  seenMessageEntity,
  syncCursorEntity,
} from "../index";

const OAUTH_PROVIDER_KEY = "oauth-test";
const STATE_SECRET = "inbound-mail-connect-test-state-secret-32b";
const CALLBACK_URL = "http://localhost/inbound-mail/oauth/callback";
const CONNECT_PATH = "/api/inbound-mail/connect";
const CALLBACK_PATH = "/inbound-mail/oauth/callback";

const oauthTestPlugin: InboundMailProviderPlugin = {
  verify: async () => {},
  fetch: async () => ({ messages: [], nextCursor: { offset: 0 }, hasMore: false }),
  oauth: {
    scopes: { receive: ["mail.read"] },
    buildAuthorizeUrl: async (_ctx, p) =>
      `https://oauth.test/authorize?state=${encodeURIComponent(p.state)}&redirect_uri=${encodeURIComponent(p.redirectUri)}`,
    exchangeCode: async (_ctx, p): Promise<OAuthTokenSet> => {
      if (p.code === "fail-exchange") {
        throw new Error("token endpoint unavailable");
      }
      if (p.code === "no-refresh") {
        return {
          accessToken: "access-only",
          expiresAt: "2099-01-01T00:00:00Z",
          scopesGranted: ["mail.read"],
        };
      }
      return {
        accessToken: "access-token",
        refreshToken: "refresh-token-abc",
        expiresAt: "2099-01-01T00:00:00Z",
        scopesGranted: ["mail.read"],
      };
    },
    refreshAccessToken: async () => {
      throw new Error("not used in connect-routes tests");
    },
  },
};

const oauthTestProviderFeature = defineFeature("inbound-provider-oauth-test", (r) => {
  r.requires("inbound-mail-foundation");
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, OAUTH_PROVIDER_KEY, oauthTestPlugin);
});

let stack: TestStack;
let db: DbConnection;
let secrets: ReturnType<typeof createSecretsContext>;
let providerRef: MutableMasterKeyProvider;

beforeAll(async () => {
  const initialKp = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  providerRef = createMutableMasterKeyProvider(initialKp);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      inboundMailFoundationFeature,
      inboundProviderInMemoryFeature,
      oauthTestProviderFeature,
    ],
    masterKeyProvider: providerRef,
    extraContext: ({ db: stackDb }) => ({
      secrets: createSecretsContext({ db: stackDb, masterKeyProvider: providerRef }),
    }),
    extraRoutes: createInboundMailConnectRoutes({
      stateSecret: STATE_SECRET,
      callbackUrl: CALLBACK_URL,
    }),
  });
  db = stack.db;
  secrets = createSecretsContext({ db, masterKeyProvider: providerRef });

  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafePushTables(db, { tenant_secrets: tenantSecretsTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function authHeader(user: ReturnType<typeof adminFor>): Promise<Record<string, string>> {
  const token = await stack.jwt.sign(user);
  return { Authorization: `Bearer ${token}` };
}

async function getConnect(query: string, user?: ReturnType<typeof adminFor>) {
  const headers = user ? await authHeader(user) : {};
  return stack.app.request(`${CONNECT_PATH}?${query}`, { headers, redirect: "manual" });
}

async function getCallback(query: string) {
  return stack.app.request(`${CALLBACK_PATH}?${query}`);
}

describe("connect-routes — connect", () => {
  test("401 without session user", async () => {
    const res = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=inbox@acme.test`,
    );
    expect(res.status).toBe(401);
  });

  test("400 when query params are incomplete", async () => {
    const res = await getConnect(`provider=${OAUTH_PROVIDER_KEY}`, adminFor(4301));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_connect_request");
  });

  test("404 for unknown provider key", async () => {
    const res = await getConnect(
      "provider=does-not-exist&scope=shared&mailbox=inbox@acme.test",
      adminFor(4302),
    );
    expect(res.status).toBe(404);
  });

  test("400 when provider has no oauth flow (inmemory)", async () => {
    const res = await getConnect(
      "provider=inmemory&scope=shared&mailbox=inbox@acme.test",
      adminFor(4303),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("provider_has_no_oauth_flow");
  });

  test("302 redirect to provider authorize URL with signed state", async () => {
    const res = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=team@acme.test`,
      adminFor(4304),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe("https://oauth.test/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

describe("connect-routes — oauth callback", () => {
  test("400 when code/state missing", async () => {
    const res = await getCallback("");
    expect(res.status).toBe(400);
  });

  test("400 on tampered state", async () => {
    const res = await getCallback("code=ok&state=not.a.valid.state");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_state");
  });

  test("happy path: creates mail account + stores refresh token secret", async () => {
    const user = adminFor(4305);
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=user&mailbox=owner@acme.test`,
      user,
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackRes = await getCallback(`code=ok&state=${encodeURIComponent(state!)}`);
    expect(callbackRes.status).toBe(200);
    const body = (await callbackRes.json()) as { connected: boolean; accountId: string };
    expect(body.connected).toBe(true);
    expect(body.accountId).toBeTruthy();

    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: body.accountId });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.["provider"]).toBe(OAUTH_PROVIDER_KEY);
    expect(accounts[0]?.["ownerUserId"]).toBe(user.id);

    const stored = await secrets.get(user.tenantId, inboundCredentialSecretKey(body.accountId));
    expect(stored).toBeDefined();
    expect(stored!.reveal()).toBe("refresh-token-abc");
  });

  test("502 when token exchange fails", async () => {
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=fail@acme.test`,
      adminFor(4306),
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");

    const res = await getCallback(`code=fail-exchange&state=${encodeURIComponent(state!)}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("token_exchange_failed");
  });

  test("502 when provider omits refresh token", async () => {
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=norefresh@acme.test`,
      adminFor(4307),
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");

    const res = await getCallback(`code=no-refresh&state=${encodeURIComponent(state!)}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_refresh_token");
  });
});
