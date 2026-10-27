// Reactivation in the mailbox list: each row says how the caller re-arms the mailbox (password form or
// OAuth sign-in), only where the caller may, so no row action ends in a refusal. A disconnected or
// sign-in-failed mailbox without a stored credential answers with a plain-text message.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  IMAP_PROVIDER_KEY,
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  MailAccountReactivationPaths,
} from "../constants.ts";
import { mailAccountListScreen, myMailAccountListScreen } from "../screens.ts";
import {
  adminFor,
  type MailTestAdmin,
  type MailTestStack,
  setupMailStack,
  storeAccountCredential,
  updateAccountAsSystem,
} from "./mail-test-support.ts";

type ListedAccount = {
  readonly id: string;
  readonly status: string;
  readonly reactivateVia: string | null;
};

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

type MailboxKind = { readonly provider: string; readonly authMethod: string };
const PASSWORD_IMAP: MailboxKind = { provider: IMAP_PROVIDER_KEY, authMethod: "password" };
const OAUTH: MailboxKind = { provider: "inmemory", authMethod: "oauth" };
const PASSWORD_WITHOUT_FORM: MailboxKind = { provider: "inmemory", authMethod: "password" };

async function connect(
  admin: MailTestAdmin,
  scope: "shared" | "user",
  address: string,
  kind: MailboxKind = PASSWORD_IMAP,
  ownerUserIdOverride?: string,
) {
  const result = (await env.stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      ...kind,
      displayName: "Inbox",
      address,
      scope,
      ...(ownerUserIdOverride && { ownerUserIdOverride }),
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

async function disconnect(admin: MailTestAdmin, accountId: string) {
  await env.stack.http.writeOk(
    InboundMailFoundationHandlers.disconnectAccount,
    { accountId },
    admin,
  );
}

async function listed(user: MailTestAdmin): Promise<Map<string, ListedAccount>> {
  const { rows } = await env.stack.http.queryOk<{ rows: ListedAccount[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    user,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

describe("reactivateVia", () => {
  test("names the way back only for a mailbox the caller may re-arm", async () => {
    const owner = adminFor(6901);
    const otherAdmin = createTestUser({
      id: 6902,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });
    const shared = await connect(owner, "shared", "shared@tenant.example");
    const personal = await connect(owner, "user", "personal@tenant.example");
    const live = await connect(owner, "shared", "live@tenant.example");
    await disconnect(owner, shared);
    await disconnect(owner, personal);

    const forOwner = await listed(owner);
    expect(forOwner.get(shared)?.reactivateVia).toBe(MailAccountReactivationPaths.passwordForm);
    expect(forOwner.get(personal)?.reactivateVia).toBe(MailAccountReactivationPaths.passwordForm);
    expect(forOwner.get(live)?.reactivateVia).toBeNull();

    const forOtherAdmin = await listed(otherAdmin);
    expect(forOtherAdmin.get(shared)?.reactivateVia).toBe(
      MailAccountReactivationPaths.passwordForm,
    );
    expect(forOtherAdmin.get(personal)?.reactivateVia).toBeNull();

    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId: personal },
      otherAdmin,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
  });

  test("an OAuth mailbox goes through the sign-in, a mailbox without a form gets no action", async () => {
    const admin = adminFor(6904);
    const oauth = await connect(admin, "shared", "oauth@tenant.example", OAUTH);
    const formless = await connect(
      admin,
      "shared",
      "formless@tenant.example",
      PASSWORD_WITHOUT_FORM,
    );
    const signInFailed = await connect(admin, "shared", "failed@tenant.example");
    await disconnect(admin, oauth);
    await disconnect(admin, formless);
    await updateAccountAsSystem(env.stack, admin.tenantId, {
      accountId: signInFailed,
      status: InboundMailAccountStatuses.authError,
    });

    const rows = await listed(admin);
    expect(rows.get(oauth)?.reactivateVia).toBe(MailAccountReactivationPaths.oauthFlow);
    expect(rows.get(formless)?.reactivateVia).toBeNull();
    expect(rows.get(signInFailed)?.reactivateVia).toBe(MailAccountReactivationPaths.passwordForm);
  });

  test("a disconnected mailbox without a stored credential names the missing sign-in", async () => {
    const admin = adminFor(6903);
    const accountId = await connect(admin, "shared", "nocred@tenant.example");
    await disconnect(admin, accountId);

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );

    expect(error.i18nKey).toBe(InboundMailConnectErrors.credentialRequired.i18nKey);
  });

  test.each([[InboundMailAccountStatuses.authError], [InboundMailAccountStatuses.degraded]])(
    "a %s mailbox without a stored credential is not re-armed either",
    async (status) => {
      const admin = adminFor(status === InboundMailAccountStatuses.authError ? 6905 : 6906);
      const accountId = await connect(admin, "shared", `nocred-${status}@tenant.example`);
      await updateAccountAsSystem(env.stack, admin.tenantId, { accountId, status });

      const error = await env.stack.http.writeErr(
        InboundMailFoundationHandlers.reactivateAccount,
        { accountId },
        admin,
      );

      expect(error.i18nKey).toBe(InboundMailConnectErrors.credentialRequired.i18nKey);
      expect((await listed(admin)).get(accountId)?.status).toBe(status);
    },
  );
});

describe("reactivate-account with the User role", () => {
  test("the owner of a personal mailbox re-arms it, a shared mailbox stays with the admins", async () => {
    const admin = adminFor(6907);
    const owner = createTestUser({ id: 6908, tenantId: admin.tenantId, roles: ["User"] });
    // connect-account is admin-only; the OAuth callback connects for a user the same way, by override.
    const personal = await connect(admin, "user", "mine@tenant.example", PASSWORD_IMAP, owner.id);
    const shared = await connect(admin, "shared", "team@tenant.example");
    await disconnect(admin, personal);
    await disconnect(admin, shared);
    await storeAccountCredential(env, admin.tenantId, personal, owner.id);
    await storeAccountCredential(env, admin.tenantId, shared, admin.id);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId: personal },
      owner,
    );
    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId: shared },
      owner,
    );

    const rows = await listed(admin);
    expect(rows.get(personal)?.status).toBe(InboundMailAccountStatuses.active);
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
    expect(rows.get(shared)?.status).toBe(InboundMailAccountStatuses.disconnected);
  });
});

describe("mailbox list row actions", () => {
  const actionOf = (screen: typeof mailAccountListScreen, id: string) =>
    screen.rowActions?.find((candidate) => candidate.id === id);

  test("the password form and the OAuth sign-in each follow their own reactivateVia", () => {
    expect(actionOf(mailAccountListScreen, "reactivate")?.visible).toEqual({
      field: "reactivateVia",
      eq: MailAccountReactivationPaths.passwordForm,
    });
    for (const screen of [mailAccountListScreen, myMailAccountListScreen]) {
      expect(actionOf(screen, "reactivate-oauth")?.visible).toEqual({
        field: "reactivateVia",
        eq: MailAccountReactivationPaths.oauthFlow,
      });
    }
    expect(actionOf(myMailAccountListScreen, "reactivate")).toBeUndefined();
  });
});
