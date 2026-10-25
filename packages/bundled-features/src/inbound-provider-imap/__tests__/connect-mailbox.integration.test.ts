// The connect form checks the IMAP login before anything is stored: a good login leaves an active
// account whose stored credential the mailbox probe can use, a failed one leaves no account and no
// secret, and the password shows up in no event, row or error.
//
// The login cases need greenmail with its IMAPS port (see imap-foundation.integration.test.ts),
// the good login also an implicit-TLS SMTP port (greenmail offers no STARTTLS) with the same user (see
// send-from-account.integration.test.ts); they skip visibly without it. The unreachable-host and
// validation cases run everywhere.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { lookup } from "node:dns/promises";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import {
  createInboundMailFoundationFeature,
  InboundMailFoundationQueries,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import { markEvents, setupReadinessStack } from "../../readiness/__tests__/readiness-test-stack.ts";
import { ReadinessQueries, ReadinessWrites } from "../../readiness/constants.ts";
import { tenantSecretsTable } from "../../secrets/index.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { IMAP_CONNECT_ERRORS, ImapHandlers } from "../constants.ts";
import { createInboundProviderImapFeature, setImapMailHostLookup } from "../feature.ts";
import { SMTP_IMPLICIT_TLS_PORT as SMTPS_PORT } from "../smtp-client.ts";
import { reachable } from "./greenmail-mailbox.ts";

// A host name, not an IP literal: the TLS connect needs it as the SNI server name.
const HOST = process.env["IMAP_LIVE_HOST"] ?? "localhost";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const IMAPS_PORT = Number(process.env["IMAP_LIVE_TLS_PORT"] ?? 3993);
const PASSWORD = "testpass";
const WRONG_PASSWORD = "not-the-password-4711";
const MAILBOX_PROBE = "inbound-mail-foundation:probe:mailboxes";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;
// greenmail serves IMAPS with a self-signed certificate; the handler itself always verifies.
const TLS_VERIFY_ENV_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";
const originalTlsVerifyEnv = process.env[TLS_VERIFY_ENV_VAR];

const greenmailUp = (await reachable(HOST, IMAPS_PORT)) && (await reachable(HOST, IMAP_PORT));
const greenmailTest = greenmailUp ? test : test.skip;
const smtpsUp = greenmailUp && (await reachable(HOST, SMTPS_PORT));
const greenmailWithSmtpsTest = smtpsUp ? test : test.skip;
if (!greenmailUp) {
  console.warn(
    `connect-mailbox: no IMAP server on ${HOST}:${IMAPS_PORT} and :${IMAP_PORT}, login cases skipped`,
  );
} else if (!smtpsUp) {
  console.warn(`connect-mailbox: no SMTPS on ${HOST}:${SMTPS_PORT}, good-login case skipped`);
}

let stack: TestStack;
let nextTenant = 4400;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderImapFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  process.env[TLS_VERIFY_ENV_VAR] = "0";
});

afterEach(() => setImapMailHostLookup(undefined));

afterAll(async () => {
  if (originalTlsVerifyEnv === undefined) {
    delete process.env[TLS_VERIFY_ENV_VAR];
  } else {
    process.env[TLS_VERIFY_ENV_VAR] = originalTlsVerifyEnv;
  }
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
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

function form(password: string, host = HOST, port = IMAPS_PORT) {
  return {
    displayName: "Office",
    address: "testuser@example.com",
    host,
    port,
    user: "testuser",
    password,
    smtpPort: SMTPS_PORT,
  };
}

type Admin = ReturnType<typeof freshAdmin>;
type AccountRow = { id: string; status: string; provider: string };
type ProbeRow = { probe: string; status: string; targetId?: string; message: { i18nKey: string } };

async function accountsOf(admin: Admin): Promise<AccountRow[]> {
  const { rows } = await stack.http.queryOk<{ rows: AccountRow[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    admin,
  );
  return rows;
}

async function secretsOf(admin: Admin) {
  return selectMany(stack.db, tenantSecretsTable, { tenantId: admin.tenantId });
}

async function expectNothingStored(admin: Admin, newEvents: () => Promise<unknown[]>) {
  expect(await accountsOf(admin)).toEqual([]);
  expect(await secretsOf(admin)).toEqual([]);
  expect(await newEvents()).toEqual([]);
}

describe("connect mailbox form", () => {
  greenmailWithSmtpsTest(
    "a good login connects an active mailbox the probe can reach",
    async () => {
      const admin = freshAdmin();
      const newEvents = await markEvents(stack);

      const { accountId } = await stack.http.writeOk<{ accountId: string }>(
        ImapHandlers.connectMailbox,
        { ...form(PASSWORD), secure: false },
        admin,
      );

      expect(await accountsOf(admin)).toEqual([
        expect.objectContaining({ id: accountId, status: "active", provider: "imap" }),
      ]);
      const [secret] = await secretsOf(admin);
      expect(secret?.metadata.redactedPreview).toBe("IMAP login");
      expect(Bun.inspect(await newEvents(), { depth: 10 })).not.toContain(PASSWORD);
      expect(JSON.stringify(await accountsOf(admin))).not.toContain(PASSWORD);

      await stack.http.writeOk(ReadinessWrites.runProbes, {}, admin);
      await stack.drainJobs();
      const { rows } = await stack.http.queryOk<{ rows: ProbeRow[] }>(
        ReadinessQueries.latestResults,
        {},
        admin,
      );
      expect(rows.find((row) => row.probe === MAILBOX_PROBE)).toEqual(
        expect.objectContaining({ status: "ok", targetId: accountId }),
      );

      const otherTenantAdmin = freshAdmin();
      expect(await accountsOf(otherTenantAdmin)).toEqual([]);
    },
  );

  greenmailTest("a rejected login stores nothing and names the cause", async () => {
    const admin = freshAdmin();
    const newEvents = await markEvents(stack);

    const error = await stack.http.writeErr(
      ImapHandlers.connectMailbox,
      form(WRONG_PASSWORD),
      admin,
    );

    expect(error.i18nKey).toBe(IMAP_CONNECT_ERRORS.loginRejected.i18nKey);
    expect(JSON.stringify(error)).not.toContain(WRONG_PASSWORD);
    await expectNothingStored(admin, newEvents);
  });

  greenmailTest(
    "a plaintext IMAP port gets no login, even when the payload asks for it",
    async () => {
      const admin = freshAdmin();
      const newEvents = await markEvents(stack);

      const error = await stack.http.writeErr(
        ImapHandlers.connectMailbox,
        { ...form(PASSWORD, HOST, IMAP_PORT), secure: false },
        admin,
      );

      expect(error.i18nKey).toBe(IMAP_CONNECT_ERRORS.tlsFailed.i18nKey);
      await expectNothingStored(admin, newEvents);
    },
  );

  test("a host that does not resolve stores nothing and gets the unreachable text", async () => {
    setImapMailHostLookup((async (hostname: string) => {
      throw new Error(`ENOTFOUND ${hostname}`);
    }) as unknown as typeof lookup);
    const admin = freshAdmin();
    const newEvents = await markEvents(stack);

    const error = await stack.http.writeErr(
      ImapHandlers.connectMailbox,
      form(WRONG_PASSWORD, "imap.unknown-host.example"),
      admin,
    );

    expect(error.i18nKey).toBe(IMAP_CONNECT_ERRORS.hostUnreachable.i18nKey);
    expect(JSON.stringify(error)).not.toContain("unknown-host");
    await expectNothingStored(admin, newEvents);
  });

  test("a rejected form keeps the password out of the validation error", async () => {
    const admin = freshAdmin();
    const newEvents = await markEvents(stack);

    const error = await stack.http.writeErr(
      ImapHandlers.connectMailbox,
      { ...form(WRONG_PASSWORD), port: 0, address: "not-an-address" },
      admin,
    );

    expect(error.httpStatus).toBe(400);
    expect(JSON.stringify(error)).not.toContain(WRONG_PASSWORD);
    await expectNothingStored(admin, newEvents);
  });
});
