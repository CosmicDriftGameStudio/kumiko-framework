// Production runs as the application role (NOBYPASSRLS, FORCE row-level
// security). The supervisor polls outside any request, so provider secret
// reads only see the credential row when the supervisor opens the account's
// tenant scope. The default test stack connects as superuser and cannot show
// this; the secrets here live in an application-role database.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  setupTestStack,
  type TestDb,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import {
  requireCredentialSecretOnFetch,
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/feature.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createSecretsContext, tenantSecretsTable } from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  quarantineEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.ts";

let stack: TestStack;
let secretsDb: TestDb;
let secrets: ReturnType<typeof createSecretsContext>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  secretsDb = await createTestDb({ applicationRole: true });
  await unsafePushTables(secretsDb.db, { tenant_secrets: tenantSecretsTable });
  secrets = createSecretsContext({
    db: secretsDb.db,
    masterKeyProvider: createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      },
    }),
    registry: stack.registry,
  });
});

afterAll(async () => {
  await secretsDb.cleanup();
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

describe("watch-supervisor under row-level security", () => {
  test("reads the account's credential secret outside a request and ingests mail", async () => {
    const tenantId = testTenantId(4301);
    const admin = createTestUser({ id: 4301, tenantId, roles: ["TenantAdmin", "SystemAdmin"] });
    const { accountId } = (await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Team-Inbox",
        address: "inbox@tenant.example",
        scope: "shared",
      },
      admin,
    )) as { accountId: string };
    const credentialKey = inboundCredentialSecretKey(accountId);
    await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), () =>
      secrets.set(tenantId, credentialKey, "stored-credential"),
    );
    requireCredentialSecretOnFetch(accountId, credentialKey);
    await seedInboundMessage(accountId, {
      providerMessageId: "rls-uid-1",
      messageIdHeader: "rls-uid-1@example.com",
      providerThreadId: null,
      references: [],
      from: "sender@example.com",
      to: ["inbox@tenant.example"],
      cc: [],
      subject: "Subject",
      snippet: "snippet",
      receivedAtIso: "2026-07-15T10:00:00Z",
      rawMime: null,
      scope: "inbox",
    });

    const supervisor = createInboundMailSupervisor({
      providerCtx: { registry: stack.registry, secrets },
      db: stack.unscopedDb,
      dispatchWrite: ({ handlerQn, payload, tenantId: target }) =>
        stack.dispatcher.write(
          handlerQn,
          payload,
          createSystemUser(target as TenantId, [ROLES.SystemAdmin]),
        ),
      pollIntervalMs: 60_000,
    });
    await supervisor.pollOnce();
    await supervisor.stop();

    const [account] = await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId });
    expect(account?.["status"]).toBe(InboundMailAccountStatuses.active);
    const rows = await selectMany(stack.db, inboundMessagesProjectionTable, { accountId });
    expect(rows.map((row) => row["messageIdHeader"])).toEqual(["rls-uid-1@example.com"]);
  });
});
