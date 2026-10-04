// OAuth access-token refresh (#3491) — real foundation, real secrets, real
// connect-callback HTTP route, fake OAuth provider registered via
// r.useExtension. The clock is an injected Temporal instant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  createInboundMailConnectRoutes,
  createInboundMailSupervisor,
  createOAuthAccessTokenManager,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  InboundAuthError,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  type InboundMailProviderPlugin,
  inboundCredentialSecretKey,
  inboundMailFoundationFeature,
  type MailAccountRecord,
  mailAccountsProjectionTable,
  type OAuthAccessTokenManager,
  type OAuthTokenSet,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.js";
import { signOAuthState } from "../oauth-state.js";

const PROVIDER_KEY = "oauth-fake";
const STATE_SECRET = "oauth-refresh-test-state-secret-0123456789abcdef";
const CALLBACK_URL = "http://localhost/inbound-mail/oauth/callback";
const T0 = Temporal.Instant.from("2030-01-01T00:00:00Z");

type RefreshCall = { readonly accountId: string; readonly refreshToken: string };
type FetchCall = { readonly accountId: string; readonly accessToken: string | undefined };

const fake = {
  refreshCalls: [] as RefreshCall[],
  fetchCalls: [] as FetchCall[],
  watchCalls: [] as FetchCall[],
  activeRefreshes: new Map<string, number>(),
  maxActiveRefreshes: new Map<string, number>(),
  refreshDelayMs: 0,
  tokenCounter: 0,
  refresh: undefined as
    | undefined
    | ((refreshToken: string, signal: AbortSignal | undefined) => Promise<OAuthTokenSet>),
  exchange: undefined as undefined | ((code: string) => Promise<OAuthTokenSet>),
  fetchError: undefined as undefined | Error,
};

function tokenSetExpiringIn(minutes: number, refreshToken?: string): OAuthTokenSet {
  fake.tokenCounter += 1;
  return {
    accessToken: `access-${fake.tokenCounter}`,
    expiresAt: clock.add({ minutes }).toString(),
    ...(refreshToken !== undefined && { refreshToken }),
    scopesGranted: ["mail.read"],
  };
}

const fakePlugin: InboundMailProviderPlugin = {
  verify: async () => {},
  fetch: async (_ctx, account, _cursor, opts) => {
    fake.fetchCalls.push({ accountId: account.id, accessToken: opts.accessToken });
    if (fake.fetchError) throw fake.fetchError;
    return { messages: [], nextCursor: { offset: 0 }, hasMore: false };
  },
  watch: async (_ctx, account, _handlers, opts) => {
    fake.watchCalls.push({ accountId: account.id, accessToken: opts?.accessToken });
    return async () => {};
  },
  oauth: {
    scopes: { receive: ["mail.read"] },
    buildAuthorizeUrl: async () => "https://oauth.test/authorize",
    exchangeCode: async (_ctx, p) => {
      if (!fake.exchange) throw new Error("exchange not scripted");
      return fake.exchange(p.code);
    },
    refreshAccessToken: async (_ctx, account, refreshToken, opts) => {
      fake.refreshCalls.push({ accountId: account.id, refreshToken });
      // Per account: other active accounts refresh in parallel legitimately.
      const active = (fake.activeRefreshes.get(account.id) ?? 0) + 1;
      fake.activeRefreshes.set(account.id, active);
      fake.maxActiveRefreshes.set(
        account.id,
        Math.max(fake.maxActiveRefreshes.get(account.id) ?? 0, active),
      );
      try {
        if (fake.refreshDelayMs > 0) await Bun.sleep(fake.refreshDelayMs);
        return fake.refresh
          ? await fake.refresh(refreshToken, opts?.signal)
          : tokenSetExpiringIn(60);
      } finally {
        fake.activeRefreshes.set(account.id, (fake.activeRefreshes.get(account.id) ?? 1) - 1);
      }
    },
  },
};

const fakeProviderFeature = defineFeature("inbound-provider-oauth-fake", (r) => {
  r.requires("inbound-mail-foundation");
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, PROVIDER_KEY, fakePlugin);
});

let clock = T0;
let stack: TestStack;
let db: DbConnection;
let secrets: ReturnType<typeof createSecretsContext>;
let tokens: OAuthAccessTokenManager;

// The route options are fixed at stack creation, before db/secrets exist —
// delegate to the manager built right after.
const managerFacade: OAuthAccessTokenManager = {
  getAccessToken: (a, p) => tokens.getAccessToken(a, p),
  storeRefreshToken: (a, t) => tokens.storeRefreshToken(a, t),
  primeFromExchange: (a, t) => tokens.primeFromExchange(a, t),
  invalidate: (id) => tokens.invalidate(id),
};

function newManager(): OAuthAccessTokenManager {
  return createOAuthAccessTokenManager({ db, secrets, now: () => clock });
}

beforeAll(async () => {
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      inboundMailFoundationFeature,
      fakeProviderFeature,
    ],
    masterKeyProvider,
    extraContext: ({ db: stackDb, registry }) => ({
      secrets: createSecretsContext({ db: stackDb, masterKeyProvider, registry: registry }),
    }),
    extraRoutes: createInboundMailConnectRoutes({
      stateSecret: STATE_SECRET,
      callbackUrl: CALLBACK_URL,
      oauthTokens: managerFacade,
    }),
  });
  db = stack.db;
  secrets = createSecretsContext({ db, masterKeyProvider, registry: stack.registry });
  tokens = newManager();
  await unsafeCreateEntityTable(db, tenantEntity);
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

beforeEach(() => {
  clock = T0;
  fake.refreshCalls = [];
  fake.fetchCalls = [];
  fake.watchCalls = [];
  fake.activeRefreshes.clear();
  fake.maxActiveRefreshes.clear();
  fake.refreshDelayMs = 0;
  fake.tokenCounter = 0;
  fake.refresh = undefined;
  fake.exchange = undefined;
  fake.fetchError = undefined;
  tokens = newManager();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function connectOAuthAccount(
  tenantNumber: number,
  refreshToken: string,
): Promise<MailAccountRecord> {
  const admin = adminFor(tenantNumber);
  const { accountId } = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: PROVIDER_KEY,
      authMethod: "oauth",
      displayName: "OAuth inbox",
      address: `inbox${tenantNumber}@tenant.example`,
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  await tokens.storeRefreshToken({ id: accountId, tenantId: admin.tenantId }, refreshToken);
  return {
    id: accountId,
    tenantId: admin.tenantId,
    provider: PROVIDER_KEY,
    authMethod: "oauth",
    ownerUserId: null,
    address: `inbox${tenantNumber}@tenant.example`,
    displayName: "OAuth inbox",
    status: InboundMailAccountStatuses.active,
    watchState: "idle",
  };
}

function createSupervisor(opts: { manager?: OAuthAccessTokenManager; log?: (l: string) => void }) {
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry, secrets },
    db,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    pollIntervalMs: 60_000,
    watchBackoffInitialMs: 50,
    watchBackoffMaxMs: 200,
    oauthTokens: opts.manager ?? tokens,
    ...(opts.log && { log: opts.log }),
  });
}

function signedStateFor(tenantNumber: number): string {
  return signOAuthState(
    {
      tenantId: testTenantId(tenantNumber),
      ownerUserId: null,
      providerKey: PROVIDER_KEY,
      mailbox: `cb${tenantNumber}@tenant.example`,
    },
    15,
    STATE_SECRET,
  );
}

const refreshesFor = (accountId: string) =>
  fake.refreshCalls.filter((c) => c.accountId === accountId);
const fetchesFor = (accountId: string) => fake.fetchCalls.filter((c) => c.accountId === accountId);

async function storedRefreshToken(account: MailAccountRecord): Promise<string | undefined> {
  const secret = await secrets.get(account.tenantId, inboundCredentialSecretKey(account.id));
  return secret?.reveal();
}

describe("oauth refresh — poll", () => {
  test("refreshes once when no valid token is cached; fetch receives it; valid token is reused", async () => {
    const account = await connectOAuthAccount(4701, "rt-initial");
    const supervisor = createSupervisor({});

    await supervisor.pollOnce();
    expect(refreshesFor(account.id)).toEqual([
      { accountId: account.id, refreshToken: "rt-initial" },
    ]);
    const first = fetchesFor(account.id);
    expect(first).toHaveLength(1);
    expect(first[0]?.accessToken).toMatch(/^access-/);

    clock = T0.add({ minutes: 10 });
    await supervisor.pollOnce();
    expect(refreshesFor(account.id)).toHaveLength(1);
    expect(fetchesFor(account.id)[1]?.accessToken).toBe(first[0]?.accessToken);
  });

  test("refreshes again inside the expiry margin and hands the new token to fetch", async () => {
    const account = await connectOAuthAccount(4702, "rt-margin");
    const supervisor = createSupervisor({});
    await supervisor.pollOnce();
    const firstToken = fetchesFor(account.id)[0]?.accessToken;

    clock = T0.add({ minutes: 59 });
    await supervisor.pollOnce();
    expect(refreshesFor(account.id)).toHaveLength(2);
    const secondToken = fetchesFor(account.id)[1]?.accessToken;
    expect(secondToken).toBeDefined();
    expect(secondToken).not.toBe(firstToken);
  });

  test("watch start receives the access token", async () => {
    const account = await connectOAuthAccount(4703, "rt-watch");
    const supervisor = createSupervisor({});
    try {
      await supervisor.start();
      await waitFor(() => {
        expect(fake.watchCalls.some((c) => c.accountId === account.id)).toBe(true);
      });
      const call = fake.watchCalls.find((c) => c.accountId === account.id);
      expect(call?.accessToken).toMatch(/^access-/);
    } finally {
      await supervisor.stop();
    }
  });
});

describe("oauth refresh — rotation", () => {
  test("rotated refresh token is stored encrypted and used by the next refresh", async () => {
    const account = await connectOAuthAccount(4704, "rt-before-rotation");
    fake.refresh = async () => tokenSetExpiringIn(60, "rt-after-rotation-SECRET");
    const supervisor = createSupervisor({});

    await supervisor.pollOnce();
    expect(await storedRefreshToken(account)).toBe("rt-after-rotation-SECRET");

    const rows = await selectMany(db, tenantSecretsTable, {
      tenantId: account.tenantId,
      key: inboundCredentialSecretKey(account.id),
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("rt-after-rotation-SECRET");

    clock = T0.add({ hours: 2 });
    await supervisor.pollOnce();
    expect(refreshesFor(account.id).map((c) => c.refreshToken)).toEqual([
      "rt-before-rotation",
      "rt-after-rotation-SECRET",
    ]);
  });
});

describe("oauth refresh — concurrency", () => {
  test("two concurrent pollOnce in one process share a single refresh", async () => {
    const account = await connectOAuthAccount(4705, "rt-single-flight");
    fake.refreshDelayMs = 100;
    const supervisor = createSupervisor({});

    await Promise.all([supervisor.pollOnce(), supervisor.pollOnce()]);

    expect(refreshesFor(account.id)).toHaveLength(1);
    expect(fetchesFor(account.id)).toHaveLength(2);
  });

  test("two supervisors and a connect-style secret write on one account are serialized without lost updates", async () => {
    const account = await connectOAuthAccount(4706, "rt-seed");
    fake.refreshDelayMs = 100;
    fake.refresh = async (refreshToken) => tokenSetExpiringIn(60, `${refreshToken}+r`);
    const managerA = newManager();
    const managerB = newManager();
    const supervisorA = createSupervisor({ manager: managerA });
    const supervisorB = createSupervisor({ manager: managerB });

    await Promise.all([
      supervisorA.pollOnce(),
      supervisorB.pollOnce(),
      newManager().storeRefreshToken(
        { id: account.id, tenantId: account.tenantId },
        "rt-reconnected",
      ),
    ]);

    expect(fake.maxActiveRefreshes.get(account.id)).toBe(1);
    const calls = refreshesFor(account.id);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lastOutput = `${calls.at(-1)?.refreshToken}+r`;
    expect(await storedRefreshToken(account)).toBeOneOf([lastOutput, "rt-reconnected"]);
  });
});

describe("oauth refresh — failures", () => {
  test("invalid_grant moves the account to auth_error and later polls skip it", async () => {
    const account = await connectOAuthAccount(4707, "rt-revoked");
    fake.refresh = async () => {
      throw new InboundAuthError("invalid_grant");
    };
    const supervisor = createSupervisor({});

    await supervisor.pollOnce();
    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: account.id });
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.authError);
    expect(refreshesFor(account.id)).toHaveLength(1);
    expect(fetchesFor(account.id)).toHaveLength(0);

    await supervisor.pollOnce();
    expect(refreshesFor(account.id)).toHaveLength(1);
  });

  test("a transient refresh failure keeps the account active and is retried next poll", async () => {
    const account = await connectOAuthAccount(4708, "rt-flaky");
    let attempts = 0;
    fake.refresh = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connect ECONNRESET");
      return tokenSetExpiringIn(60);
    };
    const supervisor = createSupervisor({});

    await supervisor.pollOnce();
    expect(fetchesFor(account.id)).toHaveLength(0);
    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: account.id });
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);

    await supervisor.pollOnce();
    expect(fetchesFor(account.id)).toHaveLength(1);
  });

  test("a provider honoring the abort signal fails transiently without touching the secret", async () => {
    const account = await connectOAuthAccount(4712, "rt-hang");
    fake.refresh = (_rt, signal) =>
      new Promise<OAuthTokenSet>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const slowFailManager = createOAuthAccessTokenManager({
      db,
      secrets,
      now: () => clock,
      refreshTimeoutMs: 50,
    });
    const supervisor = createSupervisor({ manager: slowFailManager });

    await supervisor.pollOnce();

    expect(refreshesFor(account.id)).toHaveLength(1);
    expect(fetchesFor(account.id)).toHaveLength(0);
    expect(await storedRefreshToken(account)).toBe("rt-hang");
    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: account.id });
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);
  });

  test("no token or provider message text reaches the supervisor log", async () => {
    const account = await connectOAuthAccount(4709, "rt-log-hygiene");
    fake.refresh = async () => {
      throw new Error("refresh failed: refresh_token=LEAK-REFRESH-TOKEN");
    };
    const lines: string[] = [];
    const supervisor = createSupervisor({ log: (l) => lines.push(l) });
    await supervisor.pollOnce();

    fake.refresh = undefined;
    fake.fetchError = new Error("fetch failed: Bearer LEAK-ACCESS-TOKEN");
    await supervisor.pollOnce();

    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    for (const secret of [
      "LEAK-REFRESH-TOKEN",
      "LEAK-ACCESS-TOKEN",
      "rt-log-hygiene",
      ...fetchesFor(account.id).flatMap((c) => (c.accessToken ? [c.accessToken] : [])),
    ]) {
      expect(joined).not.toContain(secret);
    }
  });
});

describe("oauth refresh — connect callback", () => {
  test("primes the cache from the exchange: first poll does not refresh", async () => {
    fake.exchange = async () => tokenSetExpiringIn(60, "rt-from-exchange");
    const state = signedStateFor(4710);
    const res = await stack.app.request(
      `/inbound-mail/oauth/callback?code=ok&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(200);
    const { accountId } = (await res.json()) as { accountId: string };
    const primedToken = "access-1";

    const supervisor = createSupervisor({});
    await supervisor.pollOnce();

    expect(refreshesFor(accountId)).toHaveLength(0);
    expect(fetchesFor(accountId)[0]?.accessToken).toBe(primedToken);
    const stored = await secrets.get(testTenantId(4710), inboundCredentialSecretKey(accountId));
    expect(stored?.reveal()).toBe("rt-from-exchange");
  });

  test("failing exchangeCode answers 502 without the provider message", async () => {
    fake.exchange = async () => {
      throw new Error("endpoint said: access_token=LEAK-EXCHANGE-TOKEN");
    };
    const state = signedStateFor(4711);
    const res = await stack.app.request(
      `/inbound-mail/oauth/callback?code=boom&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("token_exchange_failed");
    expect(text).not.toContain("LEAK-EXCHANGE-TOKEN");
  });
});
