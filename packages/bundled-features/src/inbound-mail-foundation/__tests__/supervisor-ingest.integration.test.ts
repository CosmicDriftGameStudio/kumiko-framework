// A failing ingest must never push good mail into quarantine: an outage (every ingest fails) leaves
// the cursor and the quarantine alone, a single poison mail between good ones is quarantined after
// three counted ticks and the cursor then moves on. stop() waits for syncs that are still running.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailFoundationHandlers,
  inboundMessagesProjectionTable,
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

const INGEST_FAILURE = { isSuccess: false, error: { code: "internal_error" } } as const;

function failIngestWhen(shouldFail: (providerMessageId: string) => boolean) {
  return (write: DispatchWrite): DispatchWrite =>
    (args) => {
      if (args.handlerQn === InboundMailFoundationHandlers.ingestMessage) {
        const id = (args.payload as { providerMessageId: string }).providerMessageId;
        if (shouldFail(id)) return Promise.resolve(INGEST_FAILURE);
      }
      return write(args);
    };
}

describe("ingest failures", () => {
  test("an outage over many ticks quarantines nothing and keeps the cursor", async () => {
    const admin = adminFor(6601);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "a-1", text: "one" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "a-2", text: "two" }));
    const supervisor = createMailSupervisor(env.stack, { wrapWrite: failIngestWhen(() => true) });

    for (let tick = 0; tick < 5; tick++) await supervisor.pollOnce();

    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toEqual([]);
  });

  test("a single poison mail between good ones is quarantined after three ticks, then the cursor moves", async () => {
    const admin = adminFor(6602);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "b-1", text: "good" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "b-poison", text: "bad" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "b-3", text: "good too" }));
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "b-poison"),
    });

    for (let tick = 1; tick <= 2; tick++) {
      await supervisor.pollOnce();
      expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
      expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toEqual([]);
    }
    await supervisor.pollOnce();

    const quarantined = await selectMany(env.stack.db, quarantineTable, { accountId });
    expect(quarantined.map((row) => row["providerMessageId"])).toEqual(["b-poison"]);
    expect(quarantined[0]?.["reasonCode"]).toBe("ingest_failed");
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toHaveLength(1);
    const imported = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(imported).toHaveLength(2);
  });

  test("a failing last mail of the batch has no successor and is never counted", async () => {
    const admin = adminFor(6603);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "c-1", text: "good" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "c-last", text: "bad" }));
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => id === "c-last"),
    });

    for (let tick = 0; tick < 5; tick++) await supervisor.pollOnce();

    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
  });
});

describe("stop", () => {
  test("waits for a sync that is still running", async () => {
    const admin = adminFor(6610);
    const accountId = await connectInMemoryAccount(env.stack, admin);
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
    expect(
      await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId }),
    ).toHaveLength(1);
  });
});
