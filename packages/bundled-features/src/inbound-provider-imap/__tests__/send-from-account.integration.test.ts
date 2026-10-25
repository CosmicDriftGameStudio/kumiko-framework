// Sending from a connected mailbox over the real stack: the connect form checks the SMTP login
// next to the IMAP one, a mail sent through sendMailFromAccount reaches the recipient from the
// mailbox address over the customer's own server and lands in the mailbox's sent folder, and a
// mailbox stored without an outgoing server answers with the typed not-configured failure.
//
// The connect form always sends over port 465, so the greenmail cases need a greenmail whose
// SMTPS listens there and whose IMAPS belongs to the same instance:
//   docker run -d --name cdgs-greenmail-send -p 465:3465 -p 4993:3993 \
//     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=testuser:testpass@example.com" \
//     greenmail/standalone:2.1.0
// Without it those cases skip visibly; the not-configured case runs everywhere.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { lookup } from "node:dns/promises";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import {
  createInboundMailFoundationFeature,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
  MAIL_SEND_ERRORS,
  type OutboundMailSent,
  outboundMailMessageSchema,
  seenMessageEntity,
  sendMailFromAccount,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { ImapHandlers, SMTP_CONNECT_ERRORS } from "../constants.ts";
import { createInboundProviderImapFeature, setImapMailHostLookup } from "../feature.ts";
import { findByMessageId, reachable, withMailbox } from "./greenmail-mailbox.ts";

const HOST = process.env["IMAP_SEND_HOST"] ?? "localhost";
const IMAPS_PORT = Number(process.env["IMAP_SEND_TLS_PORT"] ?? 4993);
const SMTPS_PORT = 465;
const USER = "testuser";
const PASSWORD = "testpass";
const ADDRESS = "testuser@example.com";
const RECIPIENT = "kunde@example.org";
const SEND_HANDLER = "send-from-account-test:write:send";
const SENDER_LOGIN = { host: HOST, port: IMAPS_PORT, user: USER, password: PASSWORD };
// greenmail creates an unknown recipient on delivery, with the address as user and password.
const RECIPIENT_LOGIN = { host: HOST, port: IMAPS_PORT, user: RECIPIENT, password: RECIPIENT };

const greenmailUp = (await reachable(HOST, IMAPS_PORT)) && (await reachable(HOST, SMTPS_PORT));
const greenmailTest = greenmailUp ? test : test.skip;
if (!greenmailUp) {
  console.warn(
    `send-from-account: no IMAPS/SMTPS on ${HOST}:${IMAPS_PORT}/${SMTPS_PORT}, greenmail cases skipped`,
  );
}

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;
// greenmail serves TLS with a self-signed certificate; the provider itself always verifies.
const TLS_VERIFY_ENV_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";
const originalTlsVerifyEnv = process.env[TLS_VERIFY_ENV_VAR];

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}

const sendTestFeature = defineFeature("send-from-account-test", (r) => {
  r.writeHandler({
    name: "send",
    description: "Sends a mail from a connected mailbox, as an app's own handler would.",
    agent: { expose: false },
    schema: z.object({ accountId: z.string(), message: outboundMailMessageSchema }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => sendMailFromAccount(ctx, event.payload),
  });
});

let stack: TestStack;
let secrets: ReturnType<typeof createSecretsContext>;
let nextTenant = 4600;

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
      createInboundMailFoundationFeature(),
      createInboundProviderImapFeature(),
      sendTestFeature,
    ],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  secrets = createSecretsContext({ db: stack.db, masterKeyProvider, registry: stack.registry });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  process.env[TLS_VERIFY_ENV_VAR] = "0";
});

afterEach(() => setImapMailHostLookup(undefined));

afterAll(async () => {
  restoreEnv(TLS_VERIFY_ENV_VAR, originalTlsVerifyEnv);
  restoreEnv(MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR, originalAllowedPrivateHostsEnv);
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function freshAdmin() {
  nextTenant += 1;
  return createTestUser({
    id: nextTenant,
    tenantId: testTenantId(nextTenant),
    roles: ["TenantAdmin"],
  });
}
type Admin = ReturnType<typeof freshAdmin>;

function form(smtpHost?: string) {
  return {
    displayName: "Office",
    address: ADDRESS,
    host: HOST,
    port: IMAPS_PORT,
    user: USER,
    password: PASSWORD,
    ...(smtpHost !== undefined && { smtpHost }),
  };
}

async function connectMailbox(admin: Admin): Promise<string> {
  const { accountId } = await stack.http.writeOk<{ accountId: string }>(
    ImapHandlers.connectMailbox,
    form(""),
    admin,
  );
  return accountId;
}

describe("connect mailbox with sending", () => {
  greenmailTest(
    "an outgoing server that does not resolve fails the connect with its own text",
    async () => {
      setImapMailHostLookup((async (hostname: string) => {
        throw new Error(`ENOTFOUND ${hostname}`);
      }) as unknown as typeof lookup);
      const admin = freshAdmin();

      const error = await stack.http.writeErr(
        ImapHandlers.connectMailbox,
        form("smtp.unknown-host.example"),
        admin,
      );

      expect(error.i18nKey).toBe(SMTP_CONNECT_ERRORS.hostUnreachable.i18nKey);
      expect(JSON.stringify(error)).not.toContain("unknown-host");
      expect(JSON.stringify(error)).not.toContain(PASSWORD);
    },
  );

  greenmailTest(
    "an outgoing server on a private address is blocked like an IMAP host",
    async () => {
      setImapMailHostLookup((async () => [
        { address: "10.0.0.7", family: 4 },
      ]) as unknown as typeof lookup);
      const admin = freshAdmin();

      const error = await stack.http.writeErr(
        ImapHandlers.connectMailbox,
        form("smtp.internal.example"),
        admin,
      );

      expect(error.i18nKey).toBe(SMTP_CONNECT_ERRORS.hostUnreachable.i18nKey);
    },
  );
});

describe("sendMailFromAccount", () => {
  greenmailTest(
    "a reply goes out from the mailbox address and lands in its sent folder",
    async () => {
      await withMailbox(SENDER_LOGIN, async (client) => {
        const listed = await client.list();
        if (!listed.some((mailbox) => mailbox.path === "Sent")) await client.mailboxCreate("Sent");
      });
      const admin = freshAdmin();
      const accountId = await connectMailbox(admin);

      const sent = await stack.http.writeOk<OutboundMailSent>(
        SEND_HANDLER,
        {
          accountId,
          message: {
            to: [RECIPIENT],
            subject: "Re: Heizung defekt",
            text: "Wir kümmern uns darum.",
            inReplyTo: "original-4711@example.org",
            references: ["original-4711@example.org"],
          },
        },
        admin,
      );

      const received = await withMailbox(RECIPIENT_LOGIN, (client) =>
        findByMessageId(client, "INBOX", sent.messageIdHeader),
      );
      expect(received).toEqual({
        from: { name: "Office", address: ADDRESS },
        inReplyTo: "<original-4711@example.org>",
      });
      const copy = await withMailbox(SENDER_LOGIN, (client) =>
        findByMessageId(client, "Sent", sent.messageIdHeader),
      );
      expect(copy?.from?.address).toBe(ADDRESS);
    },
  );

  test("a mailbox stored without an outgoing server answers not configured", async () => {
    const admin = freshAdmin();
    const { accountId } = await stack.http.writeOk<{ accountId: string }>(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "imap",
        authMethod: "password",
        displayName: "Office",
        address: ADDRESS,
        scope: "shared",
      },
      admin,
    );
    await secrets.set(
      admin.tenantId,
      inboundCredentialSecretKey(accountId),
      JSON.stringify({
        host: HOST,
        port: IMAPS_PORT,
        secure: true,
        user: USER,
        password: PASSWORD,
      }),
      { redact: () => "IMAP login", hint: "IMAP login stored before sending existed" },
    );

    const error = await stack.http.writeErr(
      SEND_HANDLER,
      { accountId, message: { to: [RECIPIENT], subject: "Hallo", text: "Test" } },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.notConfigured.i18nKey);
  });
});
