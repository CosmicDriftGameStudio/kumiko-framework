// Real .eml fixtures through the production path: greenmail mailbox -> IMAP fetch -> supervisor ->
// ingest -> message:content. Covers text, original, attachments, a pathological mail that is
// quarantined, and the immediate sync after a mailbox is re-activated.
//
// Opt-in like imap-foundation.integration.test.ts: skips visibly when greenmail is down. Every test
// starts from an empty INBOX of the shared test user, so a dirty mailbox cannot hide a mail.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
  InboundMailFoundationQueries,
  InboundMailLastErrors,
  type InboundMessageContent,
  inboundCredentialSecretKey,
  inboundMessagesProjectionTable,
  isSenderAuthenticated,
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
import { reachable } from "./greenmail-mailbox.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "127.0.0.1";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const FIXTURES = `${import.meta.dir}/fixtures`;

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;

const available = await reachable(HOST, IMAP_PORT);
const liveTest = available ? test : test.skip;
if (!available) console.warn(`imap-content: no IMAP server on ${HOST}:${IMAP_PORT}, suite skipped`);

let stack: TestStack;
let secrets: ReturnType<typeof createSecretsContext>;
let nextTenant = 6500;

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
  // The shared test user's INBOX is read by other suites that assume it holds only their own mail.
  await purgeInbox();
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function withInbox<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: "testuser", pass: "testpass" },
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

async function purgeInbox(): Promise<void> {
  await withInbox(async (client) => {
    if (client.mailbox && client.mailbox.exists > 0) await client.messageDelete("1:*");
  });
}

beforeEach(async () => {
  if (available) await purgeInbox();
});

async function appendFixture(name: string): Promise<void> {
  const eml = Buffer.from(await Bun.file(`${FIXTURES}/${name}`).arrayBuffer());
  await withInbox((client) => client.append("INBOX", eml));
}

function freshAdmin() {
  nextTenant += 1;
  return createTestUser({
    id: nextTenant,
    tenantId: testTenantId(nextTenant),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

type Admin = ReturnType<typeof freshAdmin>;

async function connectImapAccount(admin: Admin, trustedAuthservId?: string): Promise<string> {
  const { accountId } = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "imap",
      authMethod: "password",
      displayName: "Greenmail",
      address: "testuser@example.com",
      scope: "shared",
      ...(trustedAuthservId !== undefined && { trustedAuthservId }),
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
      user: "testuser",
      password: "testpass",
    }),
  );
  return accountId;
}

function createSupervisor() {
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry, secrets },
    db: stack.unscopedDb,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    pollIntervalMs: 600_000,
  });
}

async function contentOf(admin: Admin, accountId: string, messageIdHeader: string) {
  const rows = await selectMany(stack.db, inboundMessagesProjectionTable, { accountId });
  const row = rows.find((r) => r["messageIdHeader"] === messageIdHeader);
  if (!row) throw new Error(`message ${messageIdHeader} was not imported`);
  return stack.http.queryOk<InboundMessageContent>(
    InboundMailFoundationQueries.messageContent,
    { messageId: row["id"] },
    admin,
  );
}

describe("fixtures through greenmail", () => {
  liveTest("text, original and attachments of the ordinary shapes", async () => {
    const admin = freshAdmin();
    const accountId = await connectImapAccount(admin);
    for (const name of [
      "html-only.eml",
      "text-with-pdf.eml",
      "inline-logo-and-apple-pdf.eml",
      "forwarded-eml-with-pdf.eml",
    ]) {
      await appendFixture(name);
    }

    await createSupervisor().pollOnce();

    const html = await contentOf(admin, accountId, "html-only@fixture.test");
    expect(html.contentState).toBe("complete");
    expect(html.bodyRef.endsWith(".eml")).toBe(true);
    const withPdf = await contentOf(admin, accountId, "text-pdf@fixture.test");
    expect(withPdf.bodyText).toBe("Please find the invoice attached.");
    expect(withPdf.attachmentFileIds).toHaveLength(1);
    const inline = await contentOf(admin, accountId, "inline@fixture.test");
    expect(inline.attachmentFileIds).toHaveLength(1);
    expect(inline.skippedAttachments).toEqual([]);
    const forwarded = await contentOf(admin, accountId, "fwd@fixture.test");
    expect(forwarded.bodyText).toContain("The original text from Bob.");
    expect(forwarded.attachmentFileIds).toHaveLength(1);
  });

  liveTest("a mail without sender and a thread of 250 References are imported", async () => {
    const admin = freshAdmin();
    const accountId = await connectImapAccount(admin);
    await appendFixture("no-from.eml");
    await appendFixture("many-references.eml");

    await createSupervisor().pollOnce();

    const rows = await selectMany(stack.db, inboundMessagesProjectionTable, { accountId });
    expect(rows).toHaveLength(2);
    const status = (await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId }))[0];
    expect(status?.["status"]).toBe(InboundMailAccountStatuses.active);
  });

  liveTest(
    "a mail the parser throws on is quarantined, the cursor moves on, acknowledging heals",
    async () => {
      const admin = freshAdmin();
      const accountId = await connectImapAccount(admin);
      await appendFixture("text-with-pdf.eml");
      await appendFixture("unparseable-too-many-parts.eml");
      await appendFixture("html-only.eml");
      const supervisor = createSupervisor();

      await supervisor.pollOnce();

      expect(
        await selectMany(stack.db, inboundMessagesProjectionTable, { accountId }),
      ).toHaveLength(2);
      expect(await selectMany(stack.db, quarantineTable, { accountId })).toHaveLength(1);
      const degraded = (
        await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId })
      )[0];
      expect(degraded?.["status"]).toBe(InboundMailAccountStatuses.degraded);
      expect(degraded?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);
      const listed = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
        InboundMailFoundationQueries.listAccounts,
        {},
        admin,
      );
      expect(listed.rows[0]?.["quarantinedCount"]).toBe(1);

      await supervisor.pollOnce();
      expect(await selectMany(stack.db, quarantineTable, { accountId })).toHaveLength(1);

      await stack.http.writeOk(
        InboundMailFoundationHandlers.acknowledgeQuarantine,
        { accountId },
        admin,
      );
      await supervisor.pollOnce();
      const healed = (
        await selectMany(stack.db, mailAccountsProjectionTable, { id: accountId })
      )[0];
      expect(healed?.["status"]).toBe(InboundMailAccountStatuses.active);
      expect(healed?.["lastError"]).toBeNull();
    },
    45_000,
  );
});

describe("immediate sync with a real mailbox", () => {
  liveTest("a re-activated mailbox imports the waiting mail without a manual poll", async () => {
    const admin = freshAdmin();
    const accountId = await connectImapAccount(admin);
    await stack.http.writeOk(InboundMailFoundationHandlers.disconnectAccount, { accountId }, admin);
    await appendFixture("html-only.eml");
    const supervisor = createSupervisor();
    await supervisor.start();
    try {
      await stack.eventDispatcher?.runOnce();
      expect(await selectMany(stack.db, inboundMessagesProjectionTable, { accountId })).toEqual([]);

      await stack.http.writeOk(
        InboundMailFoundationHandlers.reactivateAccount,
        { accountId },
        admin,
      );

      await waitFor(async () => {
        await stack.eventDispatcher?.runOnce();
        expect(
          await selectMany(stack.db, inboundMessagesProjectionTable, { accountId }),
        ).toHaveLength(1);
      });
    } finally {
      await supervisor.stop();
    }
  });
});

describe("sender authentication through greenmail", () => {
  const TRUSTED_MX = "mx.fixture.test";

  async function senderAuthenticationOf(admin: Admin, accountId: string, messageIdHeader: string) {
    const rows = await selectMany(stack.db, inboundMessagesProjectionTable, { accountId });
    const row = rows.find((r) => r["messageIdHeader"] === messageIdHeader);
    const content = await contentOf(admin, accountId, messageIdHeader);
    expect(JSON.parse(String(row?.["senderAuthentication"]))).toEqual(content.senderAuthentication);
    return content.senderAuthentication;
  }

  liveTest(
    "pass, fail, a missing header, a foreign id, a forged header and a From mismatch",
    async () => {
      const admin = freshAdmin();
      const accountId = await connectImapAccount(admin, TRUSTED_MX);
      for (const name of [
        "pass",
        "fail",
        "missing",
        "forged-below",
        "foreign-only",
        "from-mismatch",
      ]) {
        await appendFixture(`sender-auth-${name}.eml`);
      }

      await createSupervisor().pollOnce();

      const passed = await senderAuthenticationOf(admin, accountId, "auth-pass@fixture.test");
      expect(passed).toEqual({
        authservId: TRUSTED_MX,
        spf: "pass",
        dkim: "pass",
        dkimDomains: ["example.com"],
        dmarc: "pass",
        fromDomain: "example.com",
      });
      expect(isSenderAuthenticated(passed)).toBe(true);

      const failed = await senderAuthenticationOf(admin, accountId, "auth-fail@fixture.test");
      expect(failed).toMatchObject({ spf: "fail", dkim: "fail", dmarc: "fail" });
      expect(isSenderAuthenticated(failed)).toBe(false);

      expect(
        await senderAuthenticationOf(admin, accountId, "auth-missing@fixture.test"),
      ).toBeNull();
      expect(
        await senderAuthenticationOf(admin, accountId, "auth-foreign@fixture.test"),
      ).toBeNull();
      expect(
        await senderAuthenticationOf(admin, accountId, "auth-mismatch@fixture.test"),
      ).toBeNull();

      const forged = await senderAuthenticationOf(
        admin,
        accountId,
        "auth-forged-below@fixture.test",
      );
      expect(forged).toMatchObject({ spf: "fail", dkim: "none", dmarc: "fail" });
      expect(isSenderAuthenticated(forged)).toBe(false);
    },
  );

  liveTest("without a trusted authserv-id nothing is believed", async () => {
    const admin = freshAdmin();
    const accountId = await connectImapAccount(admin);
    await appendFixture("sender-auth-pass.eml");

    await createSupervisor().pollOnce();

    expect(await senderAuthenticationOf(admin, accountId, "auth-pass@fixture.test")).toBeNull();
  });

  liveTest("update-account sets the trusted id for mail imported afterwards", async () => {
    const admin = freshAdmin();
    const accountId = await connectImapAccount(admin);
    await stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, trustedAuthservId: " MX.Fixture.Test " },
      admin,
    );
    await appendFixture("sender-auth-pass.eml");

    await createSupervisor().pollOnce();

    const result = await senderAuthenticationOf(admin, accountId, "auth-pass@fixture.test");
    expect(result?.authservId).toBe(TRUSTED_MX);
  });
});
