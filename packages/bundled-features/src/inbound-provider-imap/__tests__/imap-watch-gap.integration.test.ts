// A mail that lands after the poll fetched but before the watch opened its mailbox sits below the
// watch's uidNext. Only the catch-up poll after watch start can import it before the next tick.
// Skips visibly when greenmail is down.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createDistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createMutableMasterKeyProvider,
  resetPiiSubjectKmsForTests,
  waitFor,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  type InboundMailProviderPlugin,
  inboundCredentialSecretKey,
  ingestFailureEntity,
  quarantineEntity,
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
import { imapInboundMailPlugin } from "../feature.ts";
import { greenmailAvailable } from "./greenmail-availability.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "127.0.0.1";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const SMTP_PORT = Number(process.env["IMAP_LIVE_SMTP_PORT"] ?? 3025);
const USER = "testuser";
const PASSWORD = "testpass";
const ADDRESS = "testuser@example.com";
const GAP_PROVIDER_KEY = "imap-watch-gap";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;

const available = await greenmailAvailable("imap-watch-gap", [
  { host: HOST, port: IMAP_PORT },
  { host: HOST, port: SMTP_PORT },
]);
const liveTest = available ? test : test.skip;

async function mailIsInMailbox(subject: string): Promise<boolean> {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: USER, pass: PASSWORD },
    logger: false,
  });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const hits = await client.search({ subject });
    return hits !== false && hits.length > 0;
  } finally {
    await client.logout();
  }
}

async function deliverBeforeWatchOpens(subject: string): Promise<void> {
  const transport = createTransport({ host: HOST, port: SMTP_PORT, secure: false });
  await transport.sendMail({
    from: "Sender <sender@example.com>",
    to: ADDRESS,
    subject,
    text: "gap",
  });
  transport.close();
  await waitFor(async () => {
    expect(await mailIsInMailbox(subject)).toBe(true);
  });
}

let gapSubject = "";
const gapPlugin: InboundMailProviderPlugin = {
  ...imapInboundMailPlugin,
  watch: async (ctx, account, handlers, opts) => {
    await deliverBeforeWatchOpens(gapSubject);
    const realWatch = imapInboundMailPlugin.watch;
    if (!realWatch) throw new Error("imap plugin lost its watch");
    return realWatch(ctx, account, handlers, opts);
  },
};

const gapProviderFeature = defineFeature("inbound-provider-imap-watch-gap", (r) => {
  r.requires({ features: ["inbound-mail-foundation"] });
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, GAP_PROVIDER_KEY, gapPlugin);
});

let stack: TestStack;
let db: DbConnection;
let secrets: ReturnType<typeof createSecretsContext>;

beforeAll(async () => {
  if (!available) return;
  const providerRef = createMutableMasterKeyProvider(
    createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      },
    }),
  );
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFilesFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      gapProviderFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
    masterKeyProvider: providerRef,
    extraContext: ({ db: stackDb, registry }) => ({
      secrets: createSecretsContext({ db: stackDb, masterKeyProvider: providerRef, registry }),
    }),
  });
  db = stack.db;
  secrets = createSecretsContext({ db, masterKeyProvider: providerRef, registry: stack.registry });
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  await unsafeCreateEntityTable(db, ingestFailureEntity);
  await unsafePushTables(db, { tenant_secrets: tenantSecretsTable });
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

describe("imap watch gap — greenmail + supervisor", () => {
  liveTest(
    "a mail delivered between the poll and the watch start is imported without another tick",
    async () => {
      const admin = createTestUser({
        id: 4311,
        tenantId: testTenantId(4311),
        roles: ["TenantAdmin", "SystemAdmin"],
      });
      const connected = (await stack.http.writeOk(
        InboundMailFoundationHandlers.connectAccount,
        {
          provider: GAP_PROVIDER_KEY,
          authMethod: "password",
          displayName: "Gap Inbox",
          address: ADDRESS,
          scope: "shared",
        },
        admin,
      )) as { accountId: string };
      await secrets.set(
        admin.tenantId,
        inboundCredentialSecretKey(connected.accountId),
        JSON.stringify({
          host: HOST,
          port: IMAP_PORT,
          secure: false,
          user: USER,
          password: PASSWORD,
        }),
      );

      gapSubject = `watch-gap-${crypto.randomUUID()}`;
      const supervisor = createInboundMailSupervisor({
        lock: createDistributedLock(stack.redis.redis, "test-watch-lease:"),
        providerCtx: { registry: stack.registry, secrets },
        db,
        dispatchWrite: ({ handlerQn, payload, tenantId }) =>
          stack.dispatcher.write(
            handlerQn,
            payload,
            createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
          ),
        pollIntervalMs: 60 * 60 * 1000,
        maxMessagesPerPoll: 10_000,
      });
      try {
        await supervisor.start();
        await waitFor(async () => {
          const list = (await stack.http.queryOk(
            InboundMailFoundationQueries.listMessages,
            { accountId: connected.accountId },
            admin,
          )) as { rows: Array<Record<string, unknown>> };
          expect(list.rows.some((r) => r["subject"] === gapSubject)).toBe(true);
        });
      } finally {
        await supervisor.stop();
      }
    },
    60_000,
  );
});
