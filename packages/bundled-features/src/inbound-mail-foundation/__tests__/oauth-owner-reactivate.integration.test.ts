// A user connects a personal OAuth mailbox and re-arms it alone: after a disconnect or a sign-in error,
// "Reactivate" sends the owner through the same connect route and callback, which reopens the account
// in place. Nobody else can do that for the owner, and a user cannot connect a shared mailbox.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  MailAccountReactivationPaths,
  mailAccountsProjectionTable,
} from "../index.ts";
import {
  adminFor,
  type ConnectRoutesEnv,
  type ConnectTestUser,
  connectViaOauth,
  getConnect,
  OAUTH_PROVIDER_KEY,
  setupConnectRoutesStack,
} from "./connect-routes-test-support.ts";
import { updateAccountAsSystem } from "./mail-test-support.ts";

type ListedAccount = { readonly id: string; readonly reactivateVia: string | null };

let env: ConnectRoutesEnv;

beforeAll(async () => {
  env = await setupConnectRoutesStack();
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function plainUser(id: number, tenantNumber: number): ConnectTestUser {
  return createTestUser({ id, tenantId: testTenantId(tenantNumber), roles: ["User"] });
}

function personalQuery(mailbox: string) {
  return `provider=${OAUTH_PROVIDER_KEY}&scope=user&mailbox=${encodeURIComponent(mailbox)}`;
}

async function connectPersonal(owner: ConnectTestUser, mailbox: string): Promise<string> {
  const res = await connectViaOauth(env.stack, personalQuery(mailbox), owner);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { accountId: string };
  return body.accountId;
}

async function listedFor(user: ConnectTestUser): Promise<Map<string, ListedAccount>> {
  const { rows } = await env.stack.http.queryOk<{ rows: ListedAccount[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    user,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function statusOf(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row?.["status"];
}

describe("the owner re-arms a personal OAuth mailbox", () => {
  test("after a disconnect, the owner with the User role signs in again and keeps the account", async () => {
    const tenant = 7101;
    const owner = plainUser(7102, tenant);
    const admin = adminFor(tenant);
    const accountId = await connectPersonal(owner, "owner-off@acme.test");
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );

    expect((await listedFor(owner)).get(accountId)?.reactivateVia).toBe(
      MailAccountReactivationPaths.oauthFlow,
    );
    expect((await listedFor(admin)).get(accountId)?.reactivateVia).toBeNull();

    const again = await connectViaOauth(env.stack, personalQuery("owner-off@acme.test"), owner);

    expect(again.status).toBe(200);
    expect(((await again.json()) as { accountId: string }).accountId).toBe(accountId);
    expect(await statusOf(accountId)).toBe(InboundMailAccountStatuses.active);
    expect((await listedFor(owner)).get(accountId)?.reactivateVia).toBeNull();
  });

  test("after a sign-in error, signing in again reopens the same account", async () => {
    const tenant = 7111;
    const owner = plainUser(7112, tenant);
    const accountId = await connectPersonal(owner, "owner-auth@acme.test");
    const failed = await updateAccountAsSystem(env.stack, owner.tenantId, {
      accountId,
      status: InboundMailAccountStatuses.authError,
    });
    expect(failed.isSuccess).toBe(true);
    expect((await listedFor(owner)).get(accountId)?.reactivateVia).toBe(
      MailAccountReactivationPaths.oauthFlow,
    );

    const again = await connectViaOauth(env.stack, personalQuery("owner-auth@acme.test"), owner);

    expect(again.status).toBe(200);
    expect(((await again.json()) as { accountId: string }).accountId).toBe(accountId);
    expect(await statusOf(accountId)).toBe(InboundMailAccountStatuses.active);
  });
});

describe("nobody re-arms it for the owner", () => {
  test("another user neither sees the mailbox nor takes it over through the callback", async () => {
    const tenant = 7121;
    const owner = plainUser(7122, tenant);
    const stranger = plainUser(7123, tenant);
    const accountId = await connectPersonal(owner, "owner-only@acme.test");
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      adminFor(tenant),
    );

    expect((await listedFor(stranger)).has(accountId)).toBe(false);
    const takeover = await connectViaOauth(
      env.stack,
      personalQuery("owner-only@acme.test"),
      stranger,
    );
    expect(takeover.status).toBe(409);
    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      stranger,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
    expect(await statusOf(accountId)).toBe(InboundMailAccountStatuses.disconnected);
  });

  test("a user cannot start the connect flow for a shared mailbox", async () => {
    const res = await getConnect(
      env.stack,
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=team@acme.test`,
      plainUser(7132, 7131),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("shared_mailbox_requires_admin");
  });
});
