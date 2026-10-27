// Who may bring a mailbox back: the owner alone for a personal one (a plain "User" is enough, no admin
// involved), an admin alone for a shared one. A denied caller gets the answer of a missing account and
// no login is tried for them.
//
// The success cases need greenmail like reconnect-mailbox.integration.test.ts and skip visibly without it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
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
  ingestFailureEntity,
  quarantineEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "../../inbound-mail-foundation/index.ts";
import { setupReadinessStack } from "../../readiness/__tests__/readiness-test-stack.ts";
import { tenantSecretsTable } from "../../secrets/index.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { ImapHandlers, ImapQueries } from "../constants.ts";
import { createInboundProviderImapFeature, setImapMailHostLookup } from "../feature.ts";
import { SMTP_IMPLICIT_TLS_PORT as SMTPS_PORT } from "../smtp-client.ts";
import { greenmailAvailable } from "./greenmail-availability.ts";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "localhost";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const IMAPS_PORT = Number(process.env["IMAP_LIVE_TLS_PORT"] ?? 3993);
const PASSWORD = "testpass";

const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = HOST;
const TLS_VERIFY_ENV_VAR = "NODE_TLS_REJECT_UNAUTHORIZED";
const originalTlsVerifyEnv = process.env[TLS_VERIFY_ENV_VAR];

const greenmailUp = await greenmailAvailable("reconnect-mailbox-owner", [
  { host: HOST, port: IMAPS_PORT },
  { host: HOST, port: IMAP_PORT },
]);
const smtpsUp =
  greenmailUp &&
  (await greenmailAvailable("reconnect-mailbox-owner (SMTPS)", [{ host: HOST, port: SMTPS_PORT }]));
const greenmailWithSmtpsTest = smtpsUp ? test : test.skip;

let stack: TestStack;
let nextTenant = 4700;

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

// One tenant per test: an admin who connects the mailbox, the same person as a plain member (the
// owner of a personal mailbox), another member and a second admin.
function freshTenant() {
  nextTenant += 1;
  const tenantId = testTenantId(nextTenant);
  const person = (offset: number, roles: string[]) =>
    createTestUser({ id: nextTenant * 10 + offset, tenantId, roles });
  return {
    tenantId,
    admin: person(0, ["TenantAdmin"]),
    owner: person(0, ["User"]),
    otherMember: person(1, ["User"]),
    otherAdmin: person(2, ["TenantAdmin"]),
  };
}

type Tenant = ReturnType<typeof freshTenant>;

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

async function connectBrokenAccount(tenant: Tenant, scope: "shared" | "user"): Promise<string> {
  const { accountId } = await stack.http.writeOk<{ accountId: string }>(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "imap",
      authMethod: "password",
      displayName: "Office",
      address: "testuser@example.com",
      scope,
    },
    tenant.admin,
  );
  await stack.dispatcher.write(
    InboundMailFoundationHandlers.updateAccount,
    { accountId, status: InboundMailAccountStatuses.authError },
    createSystemUser(tenant.tenantId as TenantId, [ROLES.SystemAdmin]),
  );
  return accountId;
}

async function statusOf(tenant: Tenant, accountId: string): Promise<string | undefined> {
  const { rows } = await stack.http.queryOk<{ rows: Array<{ id: string; status: string }> }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    tenant.admin,
  );
  return rows.find((row) => row.id === accountId)?.status;
}

const secretCount = async (tenant: Tenant) =>
  (await selectMany(stack.db, tenantSecretsTable, { tenantId: tenant.tenantId })).length;

describe("personal mailbox: the owner reactivates it", () => {
  greenmailWithSmtpsTest("a member with only the User role brings it back to active", async () => {
    const tenant = freshTenant();
    const accountId = await connectBrokenAccount(tenant, "user");

    const result = await stack.http.writeOk<{ accountId: string }>(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      tenant.owner,
    );

    expect(result.accountId).toBe(accountId);
    expect(await statusOf(tenant, accountId)).toBe("active");
    expect(await secretCount(tenant)).toBe(1);
    const prefill = await stack.http.queryOk<{ accountId: string } | null>(
      ImapQueries.reconnectPrefill,
      { accountId },
      tenant.owner,
    );
    expect(prefill?.accountId).toBe(accountId);
  });

  test("another member and an admin are told the mailbox does not exist, nothing changes", async () => {
    const tenant = freshTenant();
    const accountId = await connectBrokenAccount(tenant, "user");

    for (const caller of [tenant.otherMember, tenant.otherAdmin]) {
      const error = await stack.http.writeErr(
        ImapHandlers.reconnectMailbox,
        form(accountId, PASSWORD),
        caller,
      );
      expect(error.httpStatus).toBe(404);
      expect(
        await stack.http.queryOk(ImapQueries.reconnectPrefill, { accountId }, caller),
      ).toBeNull();
    }

    expect(await statusOf(tenant, accountId)).toBe("auth_error");
    expect(await secretCount(tenant)).toBe(0);
  });
});

describe("shared mailbox: an admin reactivates it", () => {
  greenmailWithSmtpsTest("an admin brings it back to active", async () => {
    const tenant = freshTenant();
    const accountId = await connectBrokenAccount(tenant, "shared");

    await stack.http.writeOk(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      tenant.otherAdmin,
    );

    expect(await statusOf(tenant, accountId)).toBe("active");
  });

  test("a plain member is told the mailbox does not exist", async () => {
    const tenant = freshTenant();
    const accountId = await connectBrokenAccount(tenant, "shared");

    const error = await stack.http.writeErr(
      ImapHandlers.reconnectMailbox,
      form(accountId, PASSWORD),
      tenant.otherMember,
    );

    expect(error.httpStatus).toBe(404);
    expect(
      await stack.http.queryOk(ImapQueries.reconnectPrefill, { accountId }, tenant.otherMember),
    ).toBeNull();
    expect(await statusOf(tenant, accountId)).toBe("auth_error");
  });
});
