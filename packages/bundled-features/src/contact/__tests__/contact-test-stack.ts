import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createChannelInAppFeature, inAppMessagesTable } from "../../channel-in-app/index.ts";
import { createChannelTelegramFeature } from "../../channel-telegram/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { configValueEntity, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import {
  type ProviderStub,
  startProviderStub,
} from "../../delivery/__tests__/chat-channel-harness.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import {
  createFileFoundationFeature,
  makeTenantStorageProviderResolver,
} from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature } from "../../file-provider-inmemory/index.ts";
import { createFilesFeature, fileRefEntity } from "../../files/index.ts";
import { noteEntryEntity, noteMentionEntity } from "../../notes-history/entity.ts";
import { createNotesHistoryFeature } from "../../notes-history/feature.ts";
import { createSecretsFeature } from "../../secrets/feature.ts";
import { createSecretsContext } from "../../secrets/secrets-context.ts";
import { tenantSecretsTable } from "../../secrets/table.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { createTierEngineFeature, tierAssignmentEntity } from "../../tier-engine/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import {
  contactReplyEntity,
  contactReplyTable,
  contactRequestEntity,
  contactRequestTable,
} from "../entity.ts";
import { createContactFeature } from "../feature.ts";
import type { ContactOptions } from "../options.ts";

export const emailTransport = createInMemoryTransport();

export const SYSTEM_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
};

export const TELEGRAM_TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

export type ContactTestStack = {
  readonly stack: TestStack;
  readonly telegram: ProviderStub;
  // The per-tenant file storage the forget and retention runs delete bytes from.
  readonly buildStorageProvider: ReturnType<typeof makeTenantStorageProviderResolver>;
};

export const FAST_SPAM_PROTECTION = { minSubmitSeconds: 0, proofOfWorkBits: 8 } as const;

export async function createContactTestStack(
  contactOptions: Partial<ContactOptions> = {},
  stackOptions: { readonly tierEngine?: boolean } = {},
): Promise<ContactTestStack> {
  const telegram = startProviderStub();
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  const configResolver = createConfigResolver();
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] }),
      createUserFeature(),
      createTenantFeature(),
      ...(stackOptions.tierEngine ? [createTierEngineFeature()] : []),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async (userId, ctx) => {
          const row = await fetchOne<{ email: string }>(ctx.db, userTable, { id: userId });
          return row?.email ?? null;
        },
      }),
      createChannelInAppFeature(),
      createChannelTelegramFeature({
        apiBaseUrl: telegram.origin,
        allowedHosts: ["127.0.0.1"],
        requireHttps: false,
        timeoutMs: 2000,
      }),
      createFilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/activate" },
      }),
      createUserDataRightsFeature(),
      createNotesHistoryFeature(),
      createContactFeature({
        appName: "Acme",
        telegram: true,
        spamProtection: FAST_SPAM_PROTECTION,
        ...contactOptions,
      }),
    ],
    masterKeyProvider,
    extraContext: (deps) => {
      const secrets = createSecretsContext({
        db: deps.db,
        masterKeyProvider,
        registry: deps.registry,
      });
      const resolver = configResolver;
      return {
        ...createDeliveryTestContext(deps, { idempotencyRedis: deps.redis, secrets }),
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
        secrets,
      };
    },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
  await unsafeCreateEntityTable(stack.db, fileRefEntity, "file-ref");
  if (stackOptions.tierEngine) await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, noteMentionEntity);
  await unsafeCreateEntityTable(stack.db, contactRequestEntity);
  await unsafeCreateEntityTable(stack.db, contactReplyEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    inAppMessagesTable,
    tenant_secrets: tenantSecretsTable,
  });
  await seedAuthMailTemplates(stack);
  const buildStorageProvider = makeTenantStorageProviderResolver({
    registry: stack.registry,
    configResolver,
    secrets: createSecretsContext({ db: stack.db, masterKeyProvider, registry: stack.registry }),
    db: stack.db,
    userId: SYSTEM_USER_ID,
    handlerName: "contact-test-storage",
  });
  return { stack, telegram, buildStorageProvider };
}

export async function resetContactTestState(ctx: ContactTestStack): Promise<void> {
  await resetTestTables(ctx.stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantTable,
    contactRequestTable,
    contactReplyTable,
    deliveryAttemptsTable,
    notificationPreferencesTable,
    inAppMessagesTable,
    configValuesTable,
    tenantSecretsTable,
    eventsTable,
  ]);
  emailTransport.sent.length = 0;
  ctx.telegram.requests.length = 0;
  await ctx.stack.redis.flushNamespace();
}
