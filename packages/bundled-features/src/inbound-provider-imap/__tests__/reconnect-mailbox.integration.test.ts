// The reconnect form replaces the credentials of an existing mailbox: a good login brings the same
// account back to active with a working credential, a failed check changes neither status nor
// secret, and disconnected, foreign-tenant and non-IMAP accounts are refused before any login.
//
// The login cases need greenmail like connect-mailbox.integration.test.ts and skip visibly without it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
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
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import { markEvents, setupReadinessStack } from "../../readiness/__tests__/readiness-test-stack.ts";
import { ReadinessQueries, ReadinessWrites } from "../../readiness/constants.ts";
import { tenantSecretsTable } from "../../secrets/index.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  IMAP_CONNECT_ERRORS,
  IMAP_RECONNECT_ERRORS,
  ImapHandlers,
  ImapQueries,
} from "../constants.ts";
import { createInboundProviderImapFeature, setImapMailHostLookup } from "../feature.ts";
import { SMTP_IMPLICIT_TLS_PORT as SMTPS_PORT } from "../smtp-client.ts";
import { reachable } from "./greenmail-mailbox.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "localhost";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const IMAPS_PORT = Number(process.env["IMAP_LIVE_TLS_PORT"] ?? 3993);
const PASSWORD = "testpass";
const WRONG_PASSWORD = "[REDACTED:generic_api_key]";
const MAILBOX_PROBE = "inbound-mail-foundation:probe:mailboxes";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;
const TLS_VERIFY_ENV_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";
const originalTlsVerifyEnv = process.env[TLS_VERIFY_ENV_VAR];

const greenmailUp = (await reachable(HOST, IMAPS_PORT)) && (await reachable(HOST, IMAP_PORT));
const smtpsUp = greenmailUp && (await reachable(HOST, SMTPS_PORT));
const greenmailTest = greenmailUp ? test : test.skip;
const greenmailWithSmtpsTest = smtpsUp ? test : test.skip;
if (!smtpsUp) {
  console.warn(`reconnect-mailbox: no IMAPS/SMTPS on ${HOST}, login cases skipped`);
}

let stack: TestStack;
let nextTenant = 4600;

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
  if (originalTlsVerifyEnv === undefined) delete process.env[TLS_VERIFY_ENV_VAR];
  else process.env[TLS_VERIFY_ENV_VAR] = originalTlsVerifyEnv;
  if (originalAllowedPrivateHostsEnv === undefined)
    delete process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  else process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
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
type AccountRow = { id: string; status: string };
type ProbeRow = { probe: string; status: string; targetId?: string };

function form(accountId: string, password: string) {
  return {
    accountId,
    host: HOST,
    port: IMAPS_PORT,
    user: "testuser",
    password,
    smtpPort: SMTPS_PORT,
  };
}

async function connectAccountRow(admin: Admin, provider: string): Promise<string> {
  const { accountId } = await stack.http.writeOk<{ accountId: string }>(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider,
      authMethod: "password",
      displayName: "Office",
      address: "testuser@example.com",
      scope: "shared",
    },
    admin,
  );
  return accountId;
}

async function connectAuthErrorAccount(admin: Admin): Promise<string> {
  const accountId = await connectAccountRow(admin, "imap");
  await stack.http.writeOk(
    InboundMailFoundationHandlers.updateAccount,
    { accountId, status: InboundMailAccountStatuses.authError },
    admin,
  );
  return accountId;
}

async function statusesOf(admin: Admin): Promise<AccountRow[]> {
  const { rows } = await stack.http.queryOk<{ rows: AccountRow[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    admin,
  );
  return rows;
}

const secretsOf = (admin: Admin) =>
  selectMany(stack.db, tenantSecretsTable, { tenantId: admin.tenantId });

describe("reconnect mailbox form", () => {
  greenmailWithSmtpsTest(
    "a good login puts the same account back to active with a credential the probe can use",
    async () => {
      const admin = freshAdmin();
      const accountId = await connectAuthErrorAccount(admin);
      expect(await secretsOf(admin)).toEqual([]);

      const result = await stack.http.writeOk<{ accountId: string }>(
        ImapHandlers.reconnectMailbox,
        form(accountId, PASSWORD),
        admin,
      );

      expect(result.accountId).toBe(accountId);
      expect(await statusesOf(admin)).toEqual([
        expect.objectContaining({ id: accountId, status: "active" }),
      ]);
      const [secret] = await secretsOf(admin);
      expect(secret?.metadata.redactedPreview).toBe("IMAP login");

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

      const prefill = await stack.http.queryOk<Record<string, unknown>>(
        ImapQueries.reconnectPrefill,
        { accountId },
        admin,
      );
      expect(prefill).toEqual({
        accountId,
        displayName: "Office",
        host: HOST,
        port: IMAPS_PORT,
        user: "testuser",
        smtpHost: HOST,
        smtpPort: SMTPS_PORT,
      });
      expect(JSON.stringify(prefill)).not.toContain(PASSWORD);
    },
  );

  greenmailTest("a rejected login leaves status and secret as they were", async () => {
    const admin = freshAdmin();
    const accountId = await connectAuthErrorAccount(admin);
    const newEvents = await markEvents(stack);

    const error = await stack.http.writeErr(
      ImapHandlers.reconnectMailbox,
      form(accountId, WRONG_PASSWORD),
      admin,
    );

    expect(error.i18nKey).toBe(IMAP_CONNECT_ERRORS.loginRejected.i18nKey);
    expect(JSON.stringify(error)).not.toContain(WRONG_PASSWORD);
    expect(await statusesOf(admin)).toEqual([
      expect.objectContaining({ id: accountId, status: "auth_error" }),
    ]);
    expect(await secretsOf(admin)).toEqual([]);
    expect(await newEvents()).toEqual([]);
  });

  test("a disconnected account cannot be reconnected", async () => {
    const admin = freshAdmin();
    const accountId = await connectAccountRow(admin, "imap");
    await stack.http.writeOk(InboundMailFoundationHandlers.disconnectAccount, { accountId }, admin);

    const error = await stack.http.writeErr(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      admin,
    );

    expect(JSON.stringify(error)).toContain("account_disconnected");
    expect(await secretsOf(admin)).toEqual([]);
  });

  test("an account id of another tenant is not found", async () => {
    const owner = freshAdmin();
    const accountId = await connectAuthErrorAccount(owner);
    const stranger = freshAdmin();

    const error = await stack.http.writeErr(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      stranger,
    );

    expect(error.httpStatus).toBe(404);
    expect(await statusesOf(owner)).toEqual([
      expect.objectContaining({ id: accountId, status: "auth_error" }),
    ]);
    const prefill = await stack.http.queryOk(ImapQueries.reconnectPrefill, { accountId }, stranger);
    expect(prefill).toBeNull();
  });

  test("a mailbox of another provider is refused", async () => {
    const admin = freshAdmin();
    const accountId = await connectAccountRow(admin, "m365-graph");

    const error = await stack.http.writeErr(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      admin,
    );

    expect(error.i18nKey).toBe(IMAP_RECONNECT_ERRORS.notPasswordImap.i18nKey);
    expect(await secretsOf(admin)).toEqual([]);
  });
});
