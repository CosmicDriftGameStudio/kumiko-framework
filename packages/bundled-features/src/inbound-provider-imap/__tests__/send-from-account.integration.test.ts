// Sending from a connected mailbox over the real stack: the connect form checks the SMTP login
// next to the IMAP one, a mail sent through sendMailFromAccount reaches the recipient from the
// mailbox address over the customer's own server and lands in the mailbox's sent folder, and a
// mailbox stored without an outgoing server answers with the typed not-configured failure.
//
// Greenmail offers no STARTTLS, so the cases connect with smtpPort 465 (implicit TLS); they need a
// greenmail whose SMTPS listens there and whose IMAPS belongs to the same instance:
//   docker run -d --name cdgs-greenmail-send -p 465:3465 -p 4993:3993 \
//     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=testuser:testpass@example.com" \
//     greenmail/standalone:2.1.0
// Without it those cases skip visibly; the not-configured case runs everywhere.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { lookup } from "node:dns/promises";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { simpleParser } from "mailparser";
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
  quarantineEntity,
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
import { SMTP_IMPLICIT_TLS_PORT } from "../smtp-client.ts";
import {
  findByMessageId,
  findSourceByMessageId,
  reachable,
  withMailbox,
} from "./greenmail-mailbox.ts";

const HOST = process.env["IMAP_SEND_HOST"] ?? "localhost";
const IMAPS_PORT = Number(process.env["IMAP_SEND_TLS_PORT"] ?? 4993);
const SMTPS_PORT = SMTP_IMPLICIT_TLS_PORT;
const USER = "testuser";
const PASSWORD = "testpass";
const ADDRESS = "testuser@example.com";
const RECIPIENT = "kunde@example.org";
const SEND_HANDLER = "send-from-account-test:write:send";
const STORE_FILE_HANDLER = "send-from-account-test:write:store-file";
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
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
  r.writeHandler({
    name: "store-file",
    description: "Stores a file of the caller's tenant, as an app's own upload would.",
    agent: { expose: false },
    schema: z.object({
      fileName: z.string(),
      mimeType: z.string(),
      base64: z.string().optional(),
      filledBytes: z.number().optional(),
    }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: event.payload.fileName,
        mimeType: event.payload.mimeType,
        data:
          event.payload.base64 !== undefined
            ? Buffer.from(event.payload.base64, "base64")
            : Buffer.alloc(event.payload.filledBytes ?? 0, 7),
      }),
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
      createFilesFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderImapFeature(),
      sendTestFeature,
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
    smtpPort: SMTPS_PORT,
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

  async function storeFile(
    admin: Admin,
    fileName: string,
    mimeType: string,
    content: Buffer | number,
  ) {
    const stored = await stack.http.writeOk<{ id: string }>(
      STORE_FILE_HANDLER,
      {
        fileName,
        mimeType,
        ...(typeof content === "number"
          ? { filledBytes: content }
          : { base64: content.toString("base64") }),
      },
      admin,
    );
    return stored.id;
  }

  async function receivedMail(messageIdHeader: string) {
    const source = await withMailbox(RECIPIENT_LOGIN, (client) =>
      findSourceByMessageId(client, "INBOX", messageIdHeader),
    );
    expect(source).toBeDefined();
    return simpleParser(source as Buffer);
  }

  greenmailTest(
    "a stored file goes out as an attachment with its name and type, and keeps the threading",
    async () => {
      const admin = freshAdmin();
      const accountId = await connectMailbox(admin);
      const fileId = await storeFile(admin, "Rechnung 4711.pdf", "application/pdf", PDF_BYTES);

      const sent = await stack.http.writeOk<OutboundMailSent>(
        SEND_HANDLER,
        {
          accountId,
          message: {
            to: [RECIPIENT],
            subject: "Re: Rechnung",
            text: "Anbei die Rechnung.",
            inReplyTo: "original-4712@example.org",
            references: ["original-4711@example.org", "original-4712@example.org"],
            attachmentFileIds: [fileId],
          },
        },
        admin,
      );

      expect(sent.attachmentFileIds).toEqual([fileId]);
      const mail = await receivedMail(sent.messageIdHeader);
      expect(mail.attachments).toHaveLength(1);
      expect(mail.attachments[0]?.filename).toBe("Rechnung 4711.pdf");
      expect(mail.attachments[0]?.contentType).toBe("application/pdf");
      expect(Buffer.compare(mail.attachments[0]?.content as Buffer, PDF_BYTES)).toBe(0);
      expect(mail.inReplyTo).toBe("<original-4712@example.org>");
      expect([mail.references ?? []].flat().map((id) => id.replace(/^<|>$/g, ""))).toEqual([
        "original-4711@example.org",
        "original-4712@example.org",
      ]);
    },
  );

  greenmailTest("the copy in the sent folder carries the attachment", async () => {
    await withMailbox(SENDER_LOGIN, async (client) => {
      const listed = await client.list();
      if (!listed.some((mailbox) => mailbox.path === "Sent")) await client.mailboxCreate("Sent");
    });
    const admin = freshAdmin();
    const accountId = await connectMailbox(admin);
    const fileId = await storeFile(admin, "scan.pdf", "application/pdf", PDF_BYTES);

    const sent = await stack.http.writeOk<OutboundMailSent>(
      SEND_HANDLER,
      {
        accountId,
        message: {
          to: [RECIPIENT],
          subject: "Scan",
          text: "Siehe Anhang",
          attachmentFileIds: [fileId],
        },
      },
      admin,
    );

    const copy = await withMailbox(SENDER_LOGIN, (client) =>
      findSourceByMessageId(client, "Sent", sent.messageIdHeader),
    );
    const parsed = await simpleParser(copy as Buffer);
    expect(parsed.attachments.map((attachment) => attachment.filename)).toEqual(["scan.pdf"]);
  });

  greenmailTest("a file of another tenant is refused and nothing is sent", async () => {
    const owner = freshAdmin();
    const foreignFileId = await storeFile(owner, "secret.pdf", "application/pdf", PDF_BYTES);
    const admin = freshAdmin();
    const accountId = await connectMailbox(admin);
    const subject = `foreign-${foreignFileId}`;

    const error = await stack.http.writeErr(
      SEND_HANDLER,
      {
        accountId,
        message: { to: [RECIPIENT], subject, text: "x", attachmentFileIds: [foreignFileId] },
      },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.attachmentInvalid.i18nKey);
    expect(await recipientSubjects()).not.toContain(subject);
  });

  greenmailTest("an unknown file id is refused like a foreign one", async () => {
    const admin = freshAdmin();
    const accountId = await connectMailbox(admin);

    const error = await stack.http.writeErr(
      SEND_HANDLER,
      {
        accountId,
        message: {
          to: [RECIPIENT],
          subject: "unknown file",
          text: "x",
          attachmentFileIds: [crypto.randomUUID()],
        },
      },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.attachmentInvalid.i18nKey);
  });

  greenmailTest("attachments above the size limit are refused and nothing is sent", async () => {
    const admin = freshAdmin();
    const accountId = await connectMailbox(admin);
    const chunk = 9 * 1024 * 1024;
    const first = await storeFile(admin, "a.bin", "application/octet-stream", chunk);
    const second = await storeFile(admin, "b.bin", "application/octet-stream", chunk);
    const third = await storeFile(admin, "c.bin", "application/octet-stream", chunk);
    const subject = `too-large-${first}`;

    const error = await stack.http.writeErr(
      SEND_HANDLER,
      {
        accountId,
        message: {
          to: [RECIPIENT],
          subject,
          text: "x",
          attachmentFileIds: [first, second, third],
        },
      },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.attachmentsTooLarge.i18nKey);
    expect(await recipientSubjects()).not.toContain(subject);
  });

  async function recipientSubjects(): Promise<string[]> {
    return withMailbox(RECIPIENT_LOGIN, async (client) => {
      const mailbox = await client.mailboxOpen("INBOX");
      if (mailbox.exists === 0) return [];
      const subjects: string[] = [];
      for await (const mail of client.fetch("1:*", { envelope: true })) {
        subjects.push(mail.envelope?.subject ?? "");
      }
      return subjects;
    });
  }

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
