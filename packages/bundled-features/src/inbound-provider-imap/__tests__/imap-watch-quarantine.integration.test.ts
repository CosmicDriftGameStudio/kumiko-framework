// An unparseable mail that arrives while the watch runs is quarantined by the watch itself, not
// at the next reconciliation poll (the poll interval here is an hour, so only the watch can do it).
// Skips visibly when greenmail is down.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { ImapFlow } from "imapflow";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailLastErrors,
  inboundCredentialSecretKey,
  ingestFailureEntity,
  mailAccountsProjectionTable,
  quarantineEntity,
  quarantineTable,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createInboundProviderImapFeature } from "../feature.ts";
import { greenmailAvailable } from "./greenmail-availability.ts";
import { buildMailWithTooManyParts, MAILPARSER_MAX_MIME_NODES } from "./too-many-parts-mail.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "127.0.0.1";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const HEALTH_REJECTED = "health update was rejected";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;

const available = await greenmailAvailable("imap-watch-quarantine", [
  { host: HOST, port: IMAP_PORT },
]);
const liveTest = available ? test : test.skip;

let stack: TestStack;
let secrets: ReturnType<typeof createSecretsContext>;
let nextTenant = 6900;

beforeAll(async () => {
  if (!available) return;
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFilesFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderImapFeature(),
    ],
    files: { storageProvider: createInMemoryFileProvider() },
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  secrets = createSecretsContext({ db: stack.db, masterKeyProvider, registry: stack.registry });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  await unsafeCreateEntityTable(stack.db, ingestFailureEntity);
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
  if (!available) return;
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function withInbox<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: "quarantineuser", pass: "testpass" },
    logger: false,
  });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    return await work(client);
  } finally {
    await client.logout();
  }
}

async function connectedAccount() {
  nextTenant += 1;
  const admin = createTestUser({
    id: nextTenant,
    tenantId: testTenantId(nextTenant),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  const { accountId } = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "imap",
      authMethod: "password",
      displayName: "Greenmail",
      address: "quarantineuser@example.com",
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  await secrets.set(
    admin.tenantId,
    inboundCredentialSecretKey(accountId),
    JSON.stringify({
      host: HOST,
      port: IMAP_PORT,
      secure: false,
      user: "quarantineuser",
      password: "testpass",
    }),
  );
  return accountId;
}

function createSupervisor(log: string[], ingested: Readonly<Record<string, unknown>>[] = []) {
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry, secrets },
    db: stack.unscopedDb,
    dispatchWrite: ({ handlerQn, payload, tenantId }) => {
      if (handlerQn === InboundMailFoundationHandlers.ingestMessage && isPlainObject(payload)) {
        ingested.push(payload);
      }
      return stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      );
    },
    pollIntervalMs: 60 * 60 * 1000,
    log: (line) => log.push(line),
  });
}

// Own greenmail user (quarantineuser, see .github/actions/kumiko-services/start.sh): a poison mail in the
// shared testuser inbox would reach the accounts of the other IMAP suites running in parallel.
// Local greenmail needs -Dgreenmail.users=testuser:testpass@example.com,quarantineuser:testpass@example.com.
async function withPoisonMail(work: () => Promise<void>): Promise<void> {
  const appended = await withInbox((client) =>
    client.append("INBOX", Buffer.from(buildMailWithTooManyParts(MAILPARSER_MAX_MIME_NODES))),
  );
  try {
    await work();
  } finally {
    if (appended) {
      await withInbox((client) => client.messageDelete(String(appended.uid), { uid: true }));
    }
  }
}

describe("unparseable mail through greenmail", () => {
  liveTest(
    "the running watch quarantines it without waiting for a poll tick",
    async () => {
      const accountId = await connectedAccount();
      const log: string[] = [];
      const supervisor = createSupervisor(log);
      try {
        await supervisor.start();
        await waitFor(async () => {
          const [row] = await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId });
          expect(row?.["watchState"]).toBe("watching");
        });

        // Mails of other suites in the shared inbox are quarantined by the first poll already, so
        // only a count above this baseline comes from the watch.
        const baseline = (await selectMany(stack.db, quarantineTable, { accountId })).length;

        await withPoisonMail(() =>
          waitFor(async () => {
            const quarantined = await selectMany(stack.db, quarantineTable, { accountId });
            expect(quarantined.length).toBeGreaterThan(baseline);
          }),
        );
      } finally {
        await supervisor.stop();
      }
    },
    60_000,
  );

  liveTest(
    "a mail the watch quarantines keeps its sender and subject",
    async () => {
      const accountId = await connectedAccount();
      const ingested: Readonly<Record<string, unknown>>[] = [];
      const supervisor = createSupervisor([], ingested);
      try {
        await supervisor.start();
        await waitFor(async () => {
          const [row] = await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId });
          expect(row?.["watchState"]).toBe("watching");
        });

        // Header imports of the first poll come with the poll's envelope; only the watch's count.
        ingested.length = 0;

        await withPoisonMail(() =>
          waitFor(async () => {
            const headerImports = ingested.filter(
              (payload) => payload["contentUnavailableReason"] === "quarantined",
            );
            expect(headerImports.length).toBeGreaterThan(0);
            for (const payload of headerImports) {
              expect(payload["subject"]).toBe("Pathological structure");
              expect(payload["from"]).toContain("alice@example.com");
            }
          }),
        );
      } finally {
        await supervisor.stop();
      }
    },
    60_000,
  );

  liveTest(
    "the health update after a quarantine is accepted: degraded with messageQuarantined",
    async () => {
      const accountId = await connectedAccount();
      const log: string[] = [];

      await withPoisonMail(async () => {
        await createSupervisor(log).pollOnce();
      });

      expect(log.filter((line) => line.includes(HEALTH_REJECTED))).toEqual([]);
      const [row] = await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId });
      expect(row?.["status"]).toBe(InboundMailAccountStatuses.degraded);
      expect(row?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);
    },
    60_000,
  );
});
