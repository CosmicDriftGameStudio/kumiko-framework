// A connected, reconnected or re-activated mailbox is synced right away: the account events wake the
// supervisor of the process through the stack's event dispatcher, no manual poll and no wait for the
// (here: ten minutes away) poll tick.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  failNextFetchWith,
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/index.ts";
import {
  InboundCredentialNotStoredError,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  registerMailAccountWakeListener,
} from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
  storeAccountCredential,
} from "./mail-test-support.ts";

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: false });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

async function drainConsumers(): Promise<void> {
  await env.stack.eventDispatcher?.runOnce();
}

async function accountStatus(accountId: string): Promise<unknown> {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row?.["status"];
}

async function importedCount(accountId: string): Promise<number> {
  const rows = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
  return rows.length;
}

describe("immediate sync", () => {
  let supervisor: ReturnType<typeof createMailSupervisor>;

  beforeEach(async () => {
    supervisor = createMailSupervisor(env.stack);
    await supervisor.start();
  });

  afterEach(async () => {
    await supervisor.stop();
  });

  test("a freshly connected mailbox is polled without a manual poll", async () => {
    const admin = adminFor(6401);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "wake-1", text: "hi" }));

    await waitFor(async () => {
      await drainConsumers();
      expect(await importedCount(accountId)).toBe(1);
    });
  });

  test("a disconnected mailbox that is reactivated syncs the mail that arrived meanwhile", async () => {
    const admin = adminFor(6402);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "wake-2", text: "later" }));
    await drainConsumers();
    expect(await importedCount(accountId)).toBe(0);
    await storeAccountCredential(env, admin.tenantId, accountId, admin.id);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );

    await waitFor(async () => {
      await drainConsumers();
      expect(await importedCount(accountId)).toBe(1);
    });
  });
});

describe("credential written after the account", () => {
  test("a woken sync that finds no credential yet sets no status, a regular poll does", async () => {
    const admin = adminFor(6420);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const supervisor = createMailSupervisor(env.stack);
    failNextFetchWith(accountId, new InboundCredentialNotStoredError("no refresh token stored"));

    await supervisor.syncAccountNow(accountId);

    expect(await accountStatus(accountId)).toBe(InboundMailAccountStatuses.active);

    failNextFetchWith(accountId, new InboundCredentialNotStoredError("no refresh token stored"));
    await supervisor.pollOnce();

    expect(await accountStatus(accountId)).toBe(InboundMailAccountStatuses.authError);
  });
});

describe("what does not wake", () => {
  test("the supervisor's own bookkeeping does not trigger another sync", async () => {
    const admin = adminFor(6410);
    const wakes: string[] = [];
    const unregister = registerMailAccountWakeListener((_tenantId, accountId) => {
      wakes.push(accountId);
    });
    try {
      const accountId = await connectInMemoryAccount(env.stack, admin);
      await waitFor(async () => {
        await drainConsumers();
        expect(wakes.filter((id) => id === accountId)).toHaveLength(1);
      });

      await env.stack.dispatcher.write(
        InboundMailFoundationHandlers.updateAccount,
        { accountId, watchState: "watching", reason: "watch_supervisor" },
        createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
      );
      await env.stack.http.writeOk(
        InboundMailFoundationHandlers.updateAccount,
        { accountId, displayName: "Renamed" },
        admin,
      );

      await waitFor(async () => {
        await drainConsumers();
        expect(wakes.filter((id) => id === accountId).length).toBeGreaterThanOrEqual(2);
      });
      // Both events are consumed once the dispatcher is idle; only the admin edit may have woken.
      while (((await env.stack.eventDispatcher?.runOnce())?.processed ?? 0) > 0) {
        // keep draining
      }
      expect(wakes.filter((id) => id === accountId)).toHaveLength(2);
    } finally {
      unregister();
    }
  });
});
