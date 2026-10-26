// Mailbox health: three failed polls in a row interrupt a mailbox ("degraded" + lastError code), a
// mail the provider cannot parse is quarantined without blocking the cursor, a mailbox without file
// storage says so, and every one of them returns to active once the cause is gone. This stack mounts
// no file storage on purpose.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  failNextFetchWith,
  resetInboundInMemory,
  seedInboundMessage,
  seedRejectedInboundMessage,
} from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  InboundMailLastErrors,
  InboundRateLimitError,
  InboundTransientError,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  quarantineTable,
} from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestAdmin,
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

async function accountRow(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row;
}

async function listedAccount(admin: MailTestAdmin, accountId: string) {
  const { rows } = await env.stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    admin,
  );
  return rows.find((row) => row["id"] === accountId);
}

describe("transient poll failures", () => {
  test("three in a row interrupt the mailbox, the next success restores it", async () => {
    const admin = adminFor(6201);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const supervisor = createMailSupervisor(env.stack);

    for (let attempt = 1; attempt <= 2; attempt++) {
      failNextFetchWith(accountId, new InboundTransientError("network down"));
      await supervisor.pollOnce();
      expect((await accountRow(accountId))?.["status"]).toBe(InboundMailAccountStatuses.active);
    }
    failNextFetchWith(accountId, new InboundTransientError("network down"));
    await supervisor.pollOnce();

    const degraded = await accountRow(accountId);
    expect(degraded?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    expect(degraded?.["lastError"]).toBe(InboundMailLastErrors.connectionFailed);
    expect(JSON.stringify(degraded)).not.toContain("network down");

    await supervisor.pollOnce();

    const healed = await accountRow(accountId);
    expect(healed?.["status"]).toBe(InboundMailAccountStatuses.active);
    expect(healed?.["lastError"]).toBeNull();
  });

  test("rate limiting is reported with its own code", async () => {
    const admin = adminFor(6202);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const supervisor = createMailSupervisor(env.stack);

    for (let attempt = 1; attempt <= 3; attempt++) {
      failNextFetchWith(accountId, new InboundRateLimitError("slow down", 1000));
      await supervisor.pollOnce();
    }

    expect((await accountRow(accountId))?.["lastError"]).toBe(InboundMailLastErrors.rateLimited);
  });
});

describe("poison mails", () => {
  test("an unparseable mail is quarantined, the rest imports, acknowledging restores the mailbox", async () => {
    const admin = adminFor(6210);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "good-1", text: "fine" }));
    seedRejectedInboundMessage(accountId, "poison-1");
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "good-2", text: "fine too" }));
    const supervisor = createMailSupervisor(env.stack);

    await supervisor.pollOnce();

    const imported = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(imported).toHaveLength(2);
    const quarantined = await selectMany(env.stack.db, quarantineTable, { accountId });
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.["providerMessageId"]).toBe("poison-1");
    expect(quarantined[0]?.["reasonCode"]).toBe("unparseable");
    const row = await accountRow(accountId);
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    expect(row?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);
    const listed = await listedAccount(admin, accountId);
    expect(listed?.["quarantinedCount"]).toBe(1);
    expect(listed?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);

    // The cursor moved on: the poison mail is not fetched and quarantined a second time.
    await supervisor.pollOnce();
    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toHaveLength(1);
    expect((await accountRow(accountId))?.["status"]).toBe(InboundMailAccountStatuses.degraded);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.acknowledgeQuarantine,
      { accountId },
      admin,
    );
    await supervisor.pollOnce();

    const restored = await accountRow(accountId);
    expect(restored?.["status"]).toBe(InboundMailAccountStatuses.active);
    expect(restored?.["lastError"]).toBeNull();
    expect((await listedAccount(admin, accountId))?.["quarantinedCount"]).toBe(0);
  });

  test("a mail that was quarantined earlier is not retried when the provider reports it again", async () => {
    const admin = adminFor(6211);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    seedRejectedInboundMessage(accountId, "poison-again");
    const supervisor = createMailSupervisor(env.stack);
    await supervisor.pollOnce();
    seedRejectedInboundMessage(accountId, "poison-again");

    await supervisor.pollOnce();

    expect(await selectMany(env.stack.db, quarantineTable, { accountId })).toHaveLength(1);
  });
});

describe("missing file storage", () => {
  test("a mail with an original is imported without it and the mailbox says why", async () => {
    const admin = adminFor(6220);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "needs-storage",
        text: "body",
        rawMime: new TextEncoder().encode("From: a@example.com\r\n\r\nbody"),
        attachments: [
          { fileName: "a.pdf", mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]) },
        ],
      }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const [message] = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(message?.["contentState"]).toBe("unavailable");
    const row = await accountRow(accountId);
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    expect(row?.["lastError"]).toBe(InboundMailLastErrors.fileStorageUnavailable);
  });
});
