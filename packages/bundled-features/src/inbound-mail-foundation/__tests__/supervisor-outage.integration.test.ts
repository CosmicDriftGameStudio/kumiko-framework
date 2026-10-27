// An outage is not a poison mail: when nothing of the account goes through (ingest handler, KMS,
// file storage, the app's storeBody hook), nothing is counted or quarantined, the account shows the
// outage, and the next interval retries from the same cursor. A failure that hits one mail while the
// others go through is counted, even when it is a storage write.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
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

const OUTAGE_INTERVALS = 5;

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
  env.setKmsDown(false);
});

const INGEST_FAILURE = { isSuccess: false, error: { code: "internal_error" } } as const;

// Fails every ingest of the matching mails, the header import of a quarantine included.
function failIngestWhen(shouldFail: (providerMessageId: string) => boolean) {
  return (write: DispatchWrite): DispatchWrite =>
    (args) => {
      if (args.handlerQn === InboundMailFoundationHandlers.ingestMessage) {
        const { providerMessageId } = args.payload as { providerMessageId: string };
        if (shouldFail(providerMessageId)) return Promise.resolve(INGEST_FAILURE);
      }
      return write(args);
    };
}

function mimeOf(text: string): Uint8Array {
  return new TextEncoder().encode(`From: a@example.com\r\n\r\n${text}`);
}

async function accountRow(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row;
}

async function importedRows(accountId: string) {
  return selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
}

async function expectOutageHeld(accountId: string, lastError: string) {
  expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
  expect(await selectMany(env.stack.db, ingestFailureTable, { accountId })).toEqual([]);
  expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toEqual([]);
  expect(await importedRows(accountId)).toEqual([]);
  const account = await accountRow(accountId);
  expect(account?.["status"]).toBe(InboundMailAccountStatuses.degraded);
  expect(account?.["lastError"]).toBe(lastError);
}

async function expectRecovered(accountId: string, imported: number) {
  expect(await importedRows(accountId)).toHaveLength(imported);
  expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toHaveLength(1);
  const account = await accountRow(accountId);
  expect(account?.["status"]).toBe(InboundMailAccountStatuses.active);
  expect(account?.["lastError"] ?? null).toBeNull();
}

async function seedTwo(accountId: string, prefix: string, withOriginal = false) {
  for (const position of [1, 2]) {
    const providerMessageId = `${prefix}-${position}`;
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId,
        text: `mail ${position}`,
        ...(withOriginal && { rawMime: mimeOf(providerMessageId) }),
      }),
    );
  }
}

describe("outage of everything", () => {
  test("a failing ingest handler for every mail quarantines nothing, the mails come in afterwards", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6620));
    await seedTwo(accountId, "a");
    const clock = tickClock();
    let down = true;
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen(() => down),
      now: clock.now,
    });

    for (let tick = 0; tick < OUTAGE_INTERVALS; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }
    await expectOutageHeld(accountId, InboundMailLastErrors.ingestUnavailable);

    down = false;
    await supervisor.pollOnce();
    await expectRecovered(accountId, 2);
  });

  test("a KMS outage over five intervals quarantines nothing, the mails come in afterwards", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6621));
    await seedTwo(accountId, "k");
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, { now: clock.now });
    env.setKmsDown(true);

    for (let tick = 0; tick < OUTAGE_INTERVALS; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }
    await expectOutageHeld(accountId, InboundMailLastErrors.encryptionUnavailable);

    env.setKmsDown(false);
    await supervisor.pollOnce();
    await expectRecovered(accountId, 2);
  });

  test("a file storage outage quarantines nothing, the mails come in afterwards", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6622));
    await seedTwo(accountId, "f", true);
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, { now: clock.now });
    env.setFileStorageDown(true);

    for (let tick = 0; tick < OUTAGE_INTERVALS; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }
    await expectOutageHeld(accountId, InboundMailLastErrors.fileStorageUnavailable);

    env.setFileStorageDown(false);
    await supervisor.pollOnce();
    await expectRecovered(accountId, 2);
  });

  test("a failing storeBody hook counts as a storage outage, not as failing mails", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6623));
    await seedTwo(accountId, "h", true);
    const clock = tickClock();
    let down = true;
    const supervisor = createMailSupervisor(env.stack, {
      now: clock.now,
      storeBody: async (_account, msg) => {
        if (down) throw new Error("app storage is down");
        return `app-store/${msg.providerMessageId}`;
      },
    });

    for (let tick = 0; tick < OUTAGE_INTERVALS; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }
    await expectOutageHeld(accountId, InboundMailLastErrors.fileStorageUnavailable);

    down = false;
    await supervisor.pollOnce();
    await expectRecovered(accountId, 2);
  });
});

describe("failure of one mail while the others go through", () => {
  test("a storage write that fails for one mail only is counted and quarantined after three intervals", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6624));
    const poisonMarker = "POISON-ORIGINAL";
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "g-1", text: "one", rawMime: mimeOf("g-1") }),
    );
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "g-poison", text: "bad", rawMime: mimeOf(poisonMarker) }),
    );
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "g-2", text: "two", rawMime: mimeOf("g-2") }),
    );
    env.setFileStorageDown((data) => new TextDecoder().decode(data).includes(poisonMarker));
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, { now: clock.now });

    for (let tick = 1; tick <= 2; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
      expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
      expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toEqual([]);
    }
    await supervisor.pollOnce();

    const quarantined = await selectMany(env.stack.db, quarantineTable, { accountId });
    expect(quarantined.map((row) => row["providerMessageId"])).toEqual(["g-poison"]);
    expect(quarantined[0]?.["reasonCode"]).toBe("ingest_failed");
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toHaveLength(1);
    // Two mails plus the header of the quarantined one.
    expect(await importedRows(accountId)).toHaveLength(3);
    expect((await accountRow(accountId))?.["lastError"]).toBe(
      InboundMailLastErrors.messageQuarantined,
    );
  });
});

describe("a mail counted before an outage", () => {
  test("a KMS outage does not carry an earlier count of a failing mail into quarantine", async () => {
    const accountId = await connectInMemoryAccount(env.stack, adminFor(6626));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "c-x", text: "x" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "c-y", text: "y" }));
    const clock = tickClock();
    let failX = true;
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestWhen((id) => failX && id === "c-x"),
      now: clock.now,
    });
    await supervisor.pollOnce();
    clock.nextInterval();
    const failureCount = async () =>
      (await selectMany(env.stack.db, ingestFailureTable, { accountId }))[0]?.["failureCount"];
    expect(await failureCount()).toBe(1);

    failX = false;
    env.setKmsDown(true);
    for (let tick = 0; tick < OUTAGE_INTERVALS; tick++) {
      await supervisor.pollOnce();
      clock.nextInterval();
    }
    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toEqual([]);
    expect(await failureCount()).toBe(1);
    expect((await accountRow(accountId))?.["lastError"]).toBe(
      InboundMailLastErrors.encryptionUnavailable,
    );

    env.setKmsDown(false);
    await supervisor.pollOnce();
    await expectRecovered(accountId, 2);
  });
});
