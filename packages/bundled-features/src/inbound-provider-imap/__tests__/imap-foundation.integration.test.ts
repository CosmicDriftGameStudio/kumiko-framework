// Full-stack IMAP integration: setupTestStack + secrets + inbound-provider-imap
// + watch-supervisor against greenmail. Proves the production path
// (connect → credential secret → poll fetch → ingest projection), not the
// plugin-only live suite in imap-live.integration.test.ts.
//
// Opt-in via greenmail (same as imap-live):
//   docker start cdgs-greenmail
//   # or: docker run -d --name cdgs-greenmail -p 3025:3025 -p 3143:3143 \
//   #   -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.users=testuser:testpass@example.com" \
//   #   greenmail/standalone:2.1.0
//
// When greenmail is down the suite skips (visible), never fakes IMAP.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
  waitFor,
} from "@cosmicdrift/kumiko-framework/testing";
import { createTransport } from "nodemailer";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import {
  createInboundMailSupervisor,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  inboundCredentialSecretKey,
  inboundMailFoundationFeature,
  mailAccountsProjectionTable,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation";
import { createSecretsContext, createSecretsFeature, tenantSecretsTable } from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { inboundProviderImapFeature } from "../feature";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "127.0.0.1";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const SMTP_PORT = Number(process.env["IMAP_LIVE_SMTP_PORT"] ?? 3025);
const USER = "testuser";
const PASSWORD = "testpass";
const ADDRESS = "testuser@example.com";

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const available = (await probe(HOST, IMAP_PORT)) && (await probe(HOST, SMTP_PORT));
const liveTest = available ? test : test.skip;
if (!available) {
  console.warn(
    `imap-foundation: kein IMAP/SMTP-Server auf ${HOST}:${IMAP_PORT}/${SMTP_PORT} — Suite wird geskippt (greenmail starten)`,
  );
}

let stack: TestStack;
let db: DbConnection;
let secrets: ReturnType<typeof createSecretsContext>;
let providerRef: MutableMasterKeyProvider;

beforeAll(async () => {
  if (!available) return;
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
      inboundProviderImapFeature,
    ],
    masterKeyProvider: providerRef,
    extraContext: ({ db: stackDb }) => ({
      secrets: createSecretsContext({ db: stackDb, masterKeyProvider: providerRef }),
    }),
  });
  db = stack.db;
  secrets = createSecretsContext({ db, masterKeyProvider: providerRef });

  await createEventsTable(db);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafePushTables(db, { tenant_secrets: tenantSecretsTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  if (!available) return;
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

function credentialJson(passwordOverride?: string): string {
  return JSON.stringify({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    user: USER,
    password: passwordOverride ?? PASSWORD,
  });
}

async function sendTestMail(subject: string, text: string): Promise<void> {
  const transport = createTransport({ host: HOST, port: SMTP_PORT, secure: false });
  await transport.sendMail({
    from: "Sender <sender@example.com>",
    to: ADDRESS,
    subject,
    text,
  });
  transport.close();
}

function createSupervisor() {
  return createInboundMailSupervisor({
    providerCtx: {
      registry: stack.registry,
      secrets,
      // Worker-identity for requireSecretsContext audit on IMAP credential reads.
      _userId: "imap-foundation-supervisor",
    },
    db,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    pollIntervalMs: 60_000,
  });
}

describe("imap-foundation — greenmail + supervisor", () => {
  liveTest(
    "connect + credential secret + pollOnce ingests a real IMAP message",
    async () => {
      const admin = adminFor(4301);
      const connected = (await stack.http.writeOk(
        InboundMailFoundationHandlers.connectAccount,
        {
          provider: "imap",
          authMethod: "password",
          displayName: "Greenmail Inbox",
          address: ADDRESS,
          scope: "shared",
        },
        admin,
      )) as { accountId: string };

      await secrets.set(
        admin.tenantId,
        inboundCredentialSecretKey(connected.accountId),
        credentialJson(),
        {
          redact: (plaintext) => `${plaintext.slice(0, 4)}…`,
          hint: "IMAP live test credentials",
        },
      );

      const supervisor = createSupervisor();
      // Drain existing mailbox first so a dirty greenmail INBOX (>maxMessages
      // backfill budget) cannot hide the message we are about to send.
      await supervisor.pollOnce();

      const subject = `foundation-poll-${crypto.randomUUID()}`;
      await sendTestMail(subject, "Hallo aus dem Foundation-Live-Test");

      await waitFor(async () => {
        await supervisor.pollOnce();
        const list = (await stack.http.queryOk(
          InboundMailFoundationQueries.listMessages,
          { accountId: connected.accountId },
          admin,
        )) as { rows: Array<Record<string, unknown>> };
        expect(list.rows.some((r) => r["subject"] === subject)).toBe(true);
      });

      const accounts = await selectMany(db, mailAccountsProjectionTable, {
        id: connected.accountId,
      });
      expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);
      expect(accounts[0]?.["provider"]).toBe("imap");
    },
    45_000,
  );

  liveTest(
    "wrong IMAP password → pollOnce marks account auth_error",
    async () => {
      const admin = adminFor(4302);
      const connected = (await stack.http.writeOk(
        InboundMailFoundationHandlers.connectAccount,
        {
          provider: "imap",
          authMethod: "password",
          displayName: "Bad Creds",
          address: ADDRESS,
          scope: "shared",
        },
        admin,
      )) as { accountId: string };

      await secrets.set(
        admin.tenantId,
        inboundCredentialSecretKey(connected.accountId),
        credentialJson("definitely-wrong"),
      );

      const supervisor = createSupervisor();
      await supervisor.pollOnce();

      const accounts = await selectMany(db, mailAccountsProjectionTable, {
        id: connected.accountId,
      });
      expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.authError);
    },
    30_000,
  );

  liveTest(
    "missing credential secret → pollOnce marks account auth_error",
    async () => {
      const admin = adminFor(4303);
      const connected = (await stack.http.writeOk(
        InboundMailFoundationHandlers.connectAccount,
        {
          provider: "imap",
          authMethod: "password",
          displayName: "No Secret",
          address: ADDRESS,
          scope: "shared",
        },
        admin,
      )) as { accountId: string };

      // No secrets.set — production path when connect succeeded but slot empty.
      const supervisor = createSupervisor();
      await supervisor.pollOnce();

      const accounts = await selectMany(db, mailAccountsProjectionTable, {
        id: connected.accountId,
      });
      expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.authError);
    },
    30_000,
  );
});
