// Shared setup of the content, health and wake integration tests: a real stack with the in-memory
// provider, optionally with file storage, plus small factories for accounts and messages.

import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type LocalKeyKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createSystemUser,
  type FeatureDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
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
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  InboundMailFoundationHandlers,
  type InboundMailSupervisorDeps,
  inboundCredentialSecretKey,
  ingestFailureEntity,
  quarantineEntity,
  type RawInboundMessage,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.ts";
import type { DispatchWrite } from "../supervisor-ingest.ts";

export type MailTestStack = {
  readonly stack: TestStack;
  /** Present when the stack was set up with file storage. */
  readonly files: InMemoryFileProvider | null;
  /** Secrets store of the stack: disconnect removes the credential, reactivate requires one. */
  readonly secrets: ReturnType<typeof createSecretsContext>;
  /** Makes every file write throw (true), only writes of matching bytes (predicate) or none (false). */
  readonly setFileStorageDown: (down: boolean | ((data: Uint8Array) => boolean)) => void;
  /** Makes every key lookup and creation of the PII key store throw, like a KMS outage. */
  readonly setKmsDown: (down: boolean) => void;
};

function breakableFileProvider(provider: InMemoryFileProvider) {
  let down: boolean | ((data: Uint8Array) => boolean) = false;
  const failWhenDown = (data: Uint8Array | null) => {
    const failing = typeof down === "function" ? data !== null && down(data) : down;
    if (failing) throw new Error("file storage is down");
  };
  const files: InMemoryFileProvider = {
    ...provider,
    write: async (key, data, mimeType) => {
      failWhenDown(data);
      return provider.write(key, data, mimeType);
    },
    writeStream: async (...args) => {
      failWhenDown(null);
      return provider.writeStream(...args);
    },
  };
  return {
    files,
    setDown: (value: boolean | ((data: Uint8Array) => boolean)) => {
      down = value;
    },
  };
}

// Explicit delegation: the adapter is a class instance with prototype methods.
function breakableKms(adapter: InMemoryKmsAdapter) {
  let down = false;
  const failWhenDown = () => {
    if (down) throw new Error("kms is down");
  };
  const kms: LocalKeyKmsAdapter = {
    capabilities: adapter.capabilities,
    createKey: async (subject) => {
      failWhenDown();
      return adapter.createKey(subject);
    },
    getKey: async (subject) => {
      failWhenDown();
      return adapter.getKey(subject);
    },
    eraseKey: (subject) => adapter.eraseKey(subject),
    health: () => adapter.health(),
  };
  return {
    kms,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

export async function setupMailStack(options: {
  readonly withFiles: boolean;
  readonly extraFeatures?: readonly FeatureDefinition[];
}): Promise<MailTestStack> {
  const breakable = options.withFiles ? breakableFileProvider(createInMemoryFileProvider()) : null;
  const files = breakable?.files ?? null;
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      ...(files ? [createFilesFeature()] : []),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
      ...(options.extraFeatures ?? []),
    ],
    ...(files ? { files: { storageProvider: files } } : {}),
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  await unsafeCreateEntityTable(stack.db, ingestFailureEntity);
  const kms = breakableKms(new InMemoryKmsAdapter());
  configurePiiSubjectKms(kms.kms);
  // The test's own handle on the same store, for credentials written outside a request.
  const secrets = createSecretsContext({
    db: stack.db,
    masterKeyProvider,
    registry: stack.registry,
  });
  return {
    stack,
    files,
    secrets,
    setFileStorageDown: (down) => breakable?.setDown(down),
    setKmsDown: kms.setDown,
  };
}

/** Stores a credential for the account, as connect and reconnect do through the IMAP provider. */
export async function storeAccountCredential(
  env: MailTestStack,
  tenantId: string,
  accountId: string,
  updatedBy: string,
): Promise<void> {
  await env.secrets.set(tenantId, inboundCredentialSecretKey(accountId), "credential", {
    updatedBy,
  });
}

/** Status, error and watch state are system-only: this is how the supervisor writes them. */
export function updateAccountAsSystem(
  stack: TestStack,
  tenantId: string,
  payload: Record<string, unknown>,
) {
  return stack.dispatcher.write(
    InboundMailFoundationHandlers.updateAccount,
    payload,
    createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
  );
}

export function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

export type MailTestAdmin = ReturnType<typeof adminFor>;

export function rawMsg(
  overrides: Partial<RawInboundMessage> & { providerMessageId: string },
): RawInboundMessage {
  return {
    messageIdHeader: `${overrides.providerMessageId}@example.com`,
    providerThreadId: null,
    references: [],
    from: "sender@example.com",
    to: ["inbox@tenant.example"],
    cc: [],
    subject: `Subject ${overrides.providerMessageId}`,
    snippet: "snippet",
    receivedAtIso: "2026-07-15T10:00:00Z",
    rawMime: null,
    scope: "inbox",
    ...overrides,
  };
}

export async function connectInMemoryAccount(
  stack: TestStack,
  admin: MailTestAdmin,
  address = "inbox@tenant.example",
): Promise<string> {
  const result = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team-Inbox",
      address,
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

const SUPERVISOR_POLL_INTERVAL_MS = 600_000;

/** Clock of the failure-count bucket: every nextInterval() is one poll interval later. */
export function tickClock() {
  let tick = 1;
  return {
    now: () => Temporal.Instant.fromEpochMilliseconds(tick * SUPERVISOR_POLL_INTERVAL_MS + 1),
    nextInterval: () => {
      tick += 1;
    },
  };
}

export function createMailSupervisor(
  stack: TestStack,
  extra: {
    readonly log?: (line: string) => void;
    readonly accountPollDeadlineMs?: number;
    readonly maxMessagesPerPoll?: number;
    /** Clock of the failure-count bucket; tests advance it to simulate poll intervals. */
    readonly now?: () => Temporal.Instant;
    /** Wraps the supervisor's own writes, e.g. to make ingest fail. */
    readonly wrapWrite?: (write: DispatchWrite) => DispatchWrite;
    readonly storeBody?: InboundMailSupervisorDeps["storeBody"];
  } = {},
) {
  const dispatchWrite: DispatchWrite = ({ handlerQn, payload, tenantId }) =>
    stack.dispatcher.write(
      handlerQn,
      payload,
      createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
    );
  const { wrapWrite, ...rest } = extra;
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry },
    db: stack.unscopedDb,
    dispatchWrite: wrapWrite ? wrapWrite(dispatchWrite) : dispatchWrite,
    // Far away on purpose: tests drive polls explicitly, never through a racing timer.
    pollIntervalMs: SUPERVISOR_POLL_INTERVAL_MS,
    watchBackoffInitialMs: 50,
    watchBackoffMaxMs: 200,
    ...rest,
  });
}
