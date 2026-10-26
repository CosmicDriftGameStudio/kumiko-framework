// Shared setup of the content, health and wake integration tests: a real stack with the in-memory
// provider, optionally with file storage, plus small factories for accounts and messages.

import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  InboundMailFoundationHandlers,
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
};

export async function setupMailStack(options: {
  readonly withFiles: boolean;
}): Promise<MailTestStack> {
  const files = options.withFiles ? createInMemoryFileProvider() : null;
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      ...(files ? [createFilesFeature()] : []),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
    ],
    ...(files ? { files: { storageProvider: files } } : {}),
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  return { stack, files };
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

export function createMailSupervisor(
  stack: TestStack,
  extra: {
    readonly log?: (line: string) => void;
    /** Wraps the supervisor's own writes, e.g. to make ingest fail. */
    readonly wrapWrite?: (write: DispatchWrite) => DispatchWrite;
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
    pollIntervalMs: 600_000,
    watchBackoffInitialMs: 50,
    watchBackoffMaxMs: 200,
    ...rest,
  });
}
