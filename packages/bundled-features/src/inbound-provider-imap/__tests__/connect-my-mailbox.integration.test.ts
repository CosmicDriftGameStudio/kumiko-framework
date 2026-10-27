// A member with only the User role connects a personal mailbox through connect-my-mailbox: the
// account is owned by the caller, a foreign or shared mailbox with the same address is never taken
// over, and connect-account keeps shared mailboxes to admins.
//
// The login cases need greenmail with IMAPS and an implicit-TLS SMTP port like
// connect-mailbox.integration.test.ts and skip visibly without it; the role cases run everywhere.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
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
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  ingestFailureEntity,
  quarantineEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import { markEvents, setupReadinessStack } from "../../readiness/__tests__/readiness-test-stack.ts";
import { tenantSecretsTable } from "../../secrets/index.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { IMAP_CONNECT_ERRORS, ImapHandlers } from "../constants.ts";
import { createInboundProviderImapFeature, setImapMailHostLookup } from "../feature.ts";
import { SMTP_IMPLICIT_TLS_PORT as SMTPS_PORT } from "../smtp-client.ts";
import { greenmailAvailable } from "./greenmail-availability.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "localhost";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const IMAPS_PORT = Number(process.env["IMAP_LIVE_TLS_PORT"] ?? 3993);
const PASSWORD = "testpass";
const WRONG_PASSWORD = "not-the-password-4711";
const ADDRESS = "testuser@example.com";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;
const TLS_VERIFY_ENV_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";
const originalTlsVerifyEnv = process.env[TLS_VERIFY_ENV_VAR];

const greenmailUp = await greenmailAvailable("connect-my-mailbox", [
  { host: HOST, port: IMAPS_PORT },
  { host: HOST, port: IMAP_PORT },
]);
const greenmailTest = greenmailUp ? test : test.skip;
const smtpsUp =
  greenmailUp &&
  (await greenmailAvailable("connect-my-mailbox (SMTPS)", [{ host: HOST, port: SMTPS_PORT }]));
const greenmailWithSmtpsTest = smtpsUp ? test : test.skip;

let stack: TestStack;
let nextTenant = 4900;

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
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  await unsafeCreateEntityTable(stack.db, ingestFailureEntity);
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

function freshTenant() {
  nextTenant += 1;
  const tenantId = testTenantId(nextTenant);
  const person = (offset: number, roles: string[]) =>
    createTestUser({ id: nextTenant * 10 + offset, tenantId, roles });
  return {
    tenantId,
    admin: person(0, ["TenantAdmin"]),
    member: person(1, ["User"]),
    otherMember: person(2, ["User"]),
    outsider: person(3, ["Guest"]),
  };
}

type Tenant = ReturnType<typeof freshTenant>;
type AccountRow = { id: string; status: string; ownerUserId: string | null };

function form(password: string) {
  return {
    displayName: "Mine",
    address: ADDRESS,
    host: HOST,
    port: IMAPS_PORT,
    user: "testuser",
    password,
    smtpPort: SMTPS_PORT,
  };
}

function connectAccountPayload(scope: "shared" | "user") {
  return {
    provider: "imap",
    authMethod: "password",
    displayName: "Office",
    address: ADDRESS,
    scope,
  };
}

async function accountsOf(
  tenant: Tenant,
  viewer: Tenant["admin"] = tenant.admin,
): Promise<AccountRow[]> {
  const { rows } = await stack.http.queryOk<{ rows: AccountRow[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    viewer,
  );
  return rows;
}

const secretCount = async (tenant: Tenant) =>
  (await selectMany(stack.db, tenantSecretsTable, { tenantId: tenant.tenantId })).length;

describe("connect-my-mailbox", () => {
  greenmailWithSmtpsTest(
    "a member with only the User role connects a personal mailbox",
    async () => {
      const tenant = freshTenant();

      const { accountId } = await stack.http.writeOk<{ accountId: string }>(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );

      const expected = expect.objectContaining({
        id: accountId,
        status: "active",
        ownerUserId: tenant.member.id,
      });
      expect(await accountsOf(tenant, tenant.member)).toEqual([expected]);
      expect(await accountsOf(tenant)).toEqual([expected]);
      expect(await secretCount(tenant)).toBe(1);
    },
  );

  test("a user without a mail member role gets 403 and nothing is stored", async () => {
    const tenant = freshTenant();

    const error = await stack.http.writeErr(
      ImapHandlers.connectMyMailbox,
      form(PASSWORD),
      tenant.outsider,
    );

    expect(error.httpStatus).toBe(403);
    expect(await accountsOf(tenant)).toEqual([]);
    expect(await secretCount(tenant)).toBe(0);
  });

  greenmailWithSmtpsTest(
    "the member's own disconnected personal mailbox is reopened under its account id",
    async () => {
      const tenant = freshTenant();
      const { accountId } = await stack.http.writeOk<{ accountId: string }>(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );
      await stack.http.writeOk(
        InboundMailFoundationHandlers.disconnectAccount,
        { accountId },
        tenant.admin,
      );

      const reopened = await stack.http.writeOk<{ accountId: string }>(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );

      expect(reopened.accountId).toBe(accountId);
      expect(await accountsOf(tenant, tenant.member)).toEqual([
        expect.objectContaining({ id: accountId, status: "active", ownerUserId: tenant.member.id }),
      ]);
      expect(await secretCount(tenant)).toBe(1);
    },
  );

  greenmailWithSmtpsTest(
    "an address of another member is refused, also after a disconnect, no second account",
    async () => {
      const tenant = freshTenant();
      // The OAuth callback's path: the system user connects on behalf of the owner.
      const connected = await stack.dispatcher.write(
        InboundMailFoundationHandlers.connectAccount,
        { ...connectAccountPayload("user"), ownerUserIdOverride: tenant.otherMember.id },
        createSystemUser(tenant.tenantId, [ROLES.SystemAdmin]),
      );
      const { accountId } = (connected as { data: { accountId: string } }).data;

      const live = await stack.http.writeErr(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );
      expect(live.i18nKey).toBe(InboundMailConnectErrors.addressAlreadyConnected.i18nKey);

      await stack.http.writeOk(
        InboundMailFoundationHandlers.disconnectAccount,
        { accountId },
        tenant.admin,
      );
      const disconnected = await stack.http.writeErr(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );
      expect(disconnected.i18nKey).toBe(InboundMailConnectErrors.addressDisconnected.i18nKey);

      expect(await accountsOf(tenant)).toEqual([
        expect.objectContaining({
          id: accountId,
          status: "disconnected",
          ownerUserId: tenant.otherMember.id,
        }),
      ]);
      expect(await secretCount(tenant)).toBe(0);
    },
  );

  greenmailWithSmtpsTest(
    "an address of a shared mailbox is refused, also after a disconnect, no second account",
    async () => {
      const tenant = freshTenant();
      const { accountId } = await stack.http.writeOk<{ accountId: string }>(
        InboundMailFoundationHandlers.connectAccount,
        connectAccountPayload("shared"),
        tenant.admin,
      );

      const live = await stack.http.writeErr(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );
      expect(live.i18nKey).toBe(InboundMailConnectErrors.addressAlreadyConnected.i18nKey);

      await stack.http.writeOk(
        InboundMailFoundationHandlers.disconnectAccount,
        { accountId },
        tenant.admin,
      );
      const disconnected = await stack.http.writeErr(
        ImapHandlers.connectMyMailbox,
        form(PASSWORD),
        tenant.member,
      );
      expect(disconnected.i18nKey).toBe(InboundMailConnectErrors.addressDisconnected.i18nKey);

      expect(await accountsOf(tenant)).toEqual([
        expect.objectContaining({ id: accountId, status: "disconnected", ownerUserId: null }),
      ]);
      expect(await secretCount(tenant)).toBe(0);
    },
  );

  greenmailTest("a rejected login stores no account and no secret", async () => {
    const tenant = freshTenant();
    const newEvents = await markEvents(stack);

    const error = await stack.http.writeErr(
      ImapHandlers.connectMyMailbox,
      form(WRONG_PASSWORD),
      tenant.member,
    );

    expect(error.i18nKey).toBe(IMAP_CONNECT_ERRORS.loginRejected.i18nKey);
    expect(JSON.stringify(error)).not.toContain(WRONG_PASSWORD);
    expect(await accountsOf(tenant)).toEqual([]);
    expect(await secretCount(tenant)).toBe(0);
    expect(await newEvents()).toEqual([]);
  });
});

describe("connect-account is admin-only", () => {
  test("a member gets 403 for both scopes and claims no address", async () => {
    const tenant = freshTenant();

    for (const scope of ["user", "shared"] as const) {
      const error = await stack.http.writeErr(
        InboundMailFoundationHandlers.connectAccount,
        connectAccountPayload(scope),
        tenant.member,
      );
      expect(error.httpStatus).toBe(403);
    }
    expect(await accountsOf(tenant)).toEqual([]);
  });

  test("an admin connects a shared mailbox", async () => {
    const tenant = freshTenant();

    await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      connectAccountPayload("shared"),
      tenant.admin,
    );

    expect(await accountsOf(tenant)).toEqual([expect.objectContaining({ ownerUserId: null })]);
  });

  test("a user without a mail member role gets 403 for both scopes", async () => {
    const tenant = freshTenant();

    for (const scope of ["user", "shared"] as const) {
      const error = await stack.http.writeErr(
        InboundMailFoundationHandlers.connectAccount,
        connectAccountPayload(scope),
        tenant.outsider,
      );
      expect(error.httpStatus).toBe(403);
    }
  });
});
