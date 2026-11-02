// One mailbox whose server never answers must not hold up the others: accounts are polled side by
// side, a sync that is still running is skipped by the next tick, and a per-account deadline
// abandons the hung sync as a failed poll without moving its cursor.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  hangFetchesOf,
  lastFetchSignalOf,
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailAccountStatuses,
  InboundMailLastErrors,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  syncCursorTable,
} from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
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

async function importedCount(accountId: string): Promise<number> {
  return (await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId })).length;
}

async function accountRow(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row;
}

async function twoAccounts(firstTenant: number) {
  const hungAccountId = await connectInMemoryAccount(env.stack, adminFor(firstTenant));
  const healthyAccountId = await connectInMemoryAccount(env.stack, adminFor(firstTenant + 1));
  await seedInboundMessage(hungAccountId, rawMsg({ providerMessageId: "hung-1", text: "a" }));
  await seedInboundMessage(healthyAccountId, rawMsg({ providerMessageId: "healthy-1", text: "b" }));
  return { hungAccountId, healthyAccountId };
}

describe("a hanging mailbox", () => {
  test("does not hold back the mail of the other mailboxes in the same poll", async () => {
    const { hungAccountId, healthyAccountId } = await twoAccounts(6301);
    const hang = hangFetchesOf(hungAccountId);
    const supervisor = createMailSupervisor(env.stack);

    const poll = supervisor.pollOnce();
    try {
      await waitFor(async () => {
        expect(await importedCount(healthyAccountId)).toBe(1);
      });
    } finally {
      hang.release();
      await poll;
    }
  });

  test("a tick skips an account whose sync is still running", async () => {
    const { hungAccountId } = await twoAccounts(6311);
    const hang = hangFetchesOf(hungAccountId);
    const supervisor = createMailSupervisor(env.stack);

    const firstTick = supervisor.pollOnce();
    try {
      await waitFor(async () => {
        expect(lastFetchSignalOf(hungAccountId)).toBeDefined();
      });
      // Joining the running sync would never return; skipping lets the second tick finish.
      await supervisor.pollOnce();
    } finally {
      hang.release();
      await firstTick;
    }
  });

  test("is abandoned at the deadline as a failed poll, keeps its cursor, and is polled again", async () => {
    const { hungAccountId, healthyAccountId } = await twoAccounts(6321);
    const hang = hangFetchesOf(hungAccountId);
    const supervisor = createMailSupervisor(env.stack, { accountPollDeadlineMs: 150 });

    // A skipped tick would leave the previous (already aborted) signal in place.
    const signals = new Set<AbortSignal>();
    for (let tick = 1; tick <= 3; tick++) {
      await supervisor.pollOnce();
      const signal = lastFetchSignalOf(hungAccountId);
      expect(signal?.aborted).toBe(true);
      if (signal) signals.add(signal);
    }
    expect(signals.size).toBe(3);

    expect(await importedCount(healthyAccountId)).toBe(1);
    const degraded = await accountRow(hungAccountId);
    expect(degraded?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    expect(degraded?.["lastError"]).toBe(InboundMailLastErrors.connectionFailed);

    hang.release();
    // The abandoned fetches finish late; their result must not be stored. The pause is only a
    // window for a wrong write to land in, never what a passing assertion waits for.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId: hungAccountId })).toEqual(
      [],
    );
    expect(await importedCount(hungAccountId)).toBe(0);

    // The recovery sync does real DB, ingest and PII work; under CI load it can pass the 150ms
    // deadline that only exists to abandon the hung fetches above. A fresh supervisor with the
    // default deadline keeps the recovery from being abandoned by that artificial limit.
    await createMailSupervisor(env.stack).pollOnce();

    expect(await importedCount(hungAccountId)).toBe(1);
    expect((await accountRow(hungAccountId))?.["status"]).toBe(InboundMailAccountStatuses.active);
    expect(
      await selectMany(env.stack.db, syncCursorTable, { accountId: hungAccountId }),
    ).toHaveLength(1);
  });
});
