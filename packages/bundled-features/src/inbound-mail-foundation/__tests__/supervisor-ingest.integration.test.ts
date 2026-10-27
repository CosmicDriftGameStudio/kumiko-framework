// A poison mail must never block its mailbox for good. Its failure counts only while other mails of
// the account go through; the count is persisted and taken once per poll interval (injected clock),
// so replicas and restarts see the same count: a poison mail is quarantined after three counted ticks
// and the cursor moves on. Outages, where nothing goes through, are in supervisor-outage.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailLastErrors,
  inboundMessagesProjectionTable,
  ingestFailureTable,
  mailAccountsProjectionTable,
  quarantineTable,
  syncCursorTable,
} from "../index.ts";
import type { DispatchWrite } from "../supervisor-ingest.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
  tickClock,
} from "./mail-test-support.ts";

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
  env.setFileStorageDown(false);
});

const INGEST_FAILURE = { isSuccess: false, error: { code: "internal_error" } } as const;

// The header import of a quarantined mail goes through the same handler: it must not fail with it.
function failIngestWhen(shouldFail: (providerMessageId: string) => boolean) {
  return (write: DispatchWrite): DispatchWrite =>
    (args) => {
      if (args.handlerQn === InboundMailFoundationHandlers.ingestMessage) {
        const payload = args.payload as {
          providerMessageId: string;
          contentUnavailableReason?: string;
        };
        if (
          payload.contentUnavailableReason !== "quarantined" &&
          shouldFail(payload.providerMessageId)
        ) {
          return Promise.resolve(INGEST_FAILURE);
        }
      }
      return write(args);
    };
}

async function accountRow(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row;
}

async function importedRows(accountId: string) {
  return selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
}

describe("ingest failures", () => {
  test("a poison mail as the newest mail is quarantined after three ticks and stays visible", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6602));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "b-1", text: "good" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "b-poison", text: "bad" }));
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "b-poison"),
      now: clock.now,
    });

    for (let tick = 1; tick <= 2; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
      expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
      expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toEqual([]);
      expect((await accountRow(accountId))?.["lastError"]).not.toBe(
        InboundMailLastErrors.connectionFailed,
      );
    }
    await supervisor.pollOnce();

    const quarantined = await selectMany(env.stack.db, quarantineTable, { accountId });
    expect(quarantined.map((row) => row["providerMessageId"])).toEqual(["b-poison"]);
    expect(quarantined[0]?.["reasonCode"]).toBe("ingest_failed");
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toHaveLength(1);
    const account = await accountRow(accountId);
    expect(account?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);
    expect(account?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    const rows = await importedRows(accountId);
    expect(rows).toHaveLength(2);
    const header = rows.find(
      (row) => row["id"] === inboundMessageAggregateId(accountId, "b-poison"),
    );
    expect(header?.["contentState"]).toBe("unavailable");
    expect(header?.["contentUnavailableReason"]).toBe("quarantined");
    expect(await selectMany(env.stack.db, ingestFailureTable, { accountId })).toEqual([]);
  });

  test("a poison mail at the end of a full batch does not hold back the mails behind it", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6603));
    const batchSize = 20;
    for (let position = 1; position <= batchSize + 5; position++) {
      const providerMessageId = position === batchSize ? "c-poison" : `c-${position}`;
      await seedInboundMessage(accountId, rawMsg({ providerMessageId, text: `mail ${position}` }));
    }
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "c-poison"),
      maxMessagesPerPoll: batchSize,
      now: clock.now,
    });

    for (let tick = 1; tick <= 3; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }

    // The message budget of the quarantining tick is used up; the five mails behind it follow next tick.
    clock.nextInterval();
    await supervisor.pollOnce();

    expect(
      (await selectMany(env.stack.db, quarantineTable, { accountId })).map(
        (row) => row["providerMessageId"],
      ),
    ).toEqual(["c-poison"]);
    // 24 good mails plus the header of the poison mail; the five behind it came with the next batch.
    expect(await importedRows(accountId)).toHaveLength(batchSize + 5);
  });

  test("two polls in the same interval count a failure once", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6604));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "d-1", text: "good" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "d-poison", text: "bad" }));
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "d-poison"),
      now: clock.now,
    });

    await supervisor.pollOnce();
    await supervisor.pollOnce();
    await supervisor.pollOnce();

    const counters = await selectMany(env.stack.db, ingestFailureTable, { accountId });
    expect(counters.map((row) => row["failureCount"])).toEqual([1]);
    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
  });

  test("a manual sync and a wake sync never count", async () => {
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "e-poison"),
    });
    await supervisor.start();
    try {
      const accountId = await connectInMemoryAccount(env.stack, adminFor(6605));
      await seedInboundMessage(accountId, rawMsg({ providerMessageId: "e-1", text: "good" }));
      await seedInboundMessage(accountId, rawMsg({ providerMessageId: "e-poison", text: "bad" }));
      // The connect event wakes the supervisor of the process.
      await env.stack.eventDispatcher?.runOnce();
      await waitFor(async () => {
        expect(await importedRows(accountId)).toHaveLength(1);
      });

      for (let sync = 0; sync < 4; sync++) await supervisor.syncAccountNow(accountId);

      expect(await selectMany(env.stack.db, ingestFailureTable, { accountId })).toEqual([]);
      expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
    } finally {
      await supervisor.stop();
    }
  });
});

describe("stop", () => {
  test("waits for a sync that is still running", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6610));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "s-1", text: "slow" }));
    const release = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: (write) => async (args) => {
        if (args.handlerQn === InboundMailFoundationHandlers.ingestMessage) {
          reached.resolve();
          await release.promise;
        }
        return write(args);
      },
    });
    const sync = supervisor.syncAccountNow(accountId);
    await reached.promise;

    let stopped = false;
    const stopping = supervisor.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    release.resolve();
    await sync;
    await stopping;
    expect(stopped).toBe(true);
    expect(await importedRows(accountId)).toHaveLength(1);
  });
});
