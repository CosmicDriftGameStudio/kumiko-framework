// Shared setup of the OAuth connect-route tests: createInboundMailConnectRoutes mounted as real
// extraRoutes on setupTestStack with an OAuth test provider, driven over real HTTP.

import { randomBytes } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createMutableMasterKeyProvider } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createInboundMailConnectRoutes,
  createInboundMailFoundationFeature,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  type InboundMailProviderPlugin,
  ingestFailureEntity,
  type OAuthTokenSet,
  quarantineEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.ts";

export const OAUTH_PROVIDER_KEY = "oauth-test";
export const STATE_SECRET = "inbound-mail-connect-test-state-secret-32b";
export const CALLBACK_URL = "http://localhost/inbound-mail/oauth/callback";
export const CONNECT_PATH = "/api/inbound-mail/connect";
export const CALLBACK_PATH = "/inbound-mail/oauth/callback";

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

export const oauthTestProviderFeature = defineFeature("inbound-provider-oauth-test", (r) => {
  r.requires({ features: ["inbound-mail-foundation"] });
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, OAUTH_PROVIDER_KEY, oauthTestPlugin);
});

export const connectRouteFeatures = [
  createConfigFeature(),
  createTenantFeature(),
  createComplianceProfilesFeature(),
  createTenantLifecycleFeature(),
  createInboundMailFoundationFeature(),
  createInboundProviderInMemoryFeature(),
  oauthTestProviderFeature,
];

export const connectRoutes = () =>
  createInboundMailConnectRoutes({ stateSecret: STATE_SECRET, callbackUrl: CALLBACK_URL });

export async function createMailAccountTables(db: DbConnection): Promise<void> {
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  await unsafeCreateEntityTable(db, ingestFailureEntity);
}

export type ConnectRoutesEnv = {
  readonly stack: TestStack;
  readonly secrets: ReturnType<typeof createSecretsContext>;
};

export async function setupConnectRoutesStack(): Promise<ConnectRoutesEnv> {
  const providerRef = createMutableMasterKeyProvider(
    createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      },
    }),
  );
  const stack = await setupTestStack({
    features: [...connectRouteFeatures, createSecretsFeature()],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef, registry }),
    }),
    extraRoutes: connectRoutes(),
  });
  await createMailAccountTables(stack.db);
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const secrets = createSecretsContext({
    db: stack.db,
    masterKeyProvider: providerRef,
    registry: stack.registry,
  });
  return { stack, secrets };
}

export function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

export type ConnectTestUser = ReturnType<typeof adminFor>;

export async function getConnect(stack: TestStack, query: string, user?: ConnectTestUser) {
  const headers: Record<string, string> = user
    ? { Authorization: `Bearer ${await stack.jwt.sign(user)}` }
    : {};
  return stack.app.request(`${CONNECT_PATH}?${query}`, { headers, redirect: "manual" });
}

export async function getCallback(stack: TestStack, query: string) {
  return stack.app.request(`${CALLBACK_PATH}?${query}`);
}

// Runs the connect route as `user` and the callback with a good code, like the provider redirect would.
export async function connectViaOauth(stack: TestStack, query: string, user: ConnectTestUser) {
  const connectRes = await getConnect(stack, query, user);
  const state = new URL(connectRes.headers.get("location") ?? "").searchParams.get("state") ?? "";
  return getCallback(stack, `code=ok&state=${encodeURIComponent(state)}`);
}
