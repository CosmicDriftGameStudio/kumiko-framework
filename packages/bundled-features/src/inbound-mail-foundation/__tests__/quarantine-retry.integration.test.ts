// Retry of a quarantined mail: the owner (or an admin) flags it, the next successful sync loads it
// again. A mail that has a header-only entry gets its content attached, one the parser never gave us
// is ingested in full; either way the quarantine entry is gone afterwards.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  resetInboundInMemory,
  seedInboundMessage,
  seedRejectedInboundMessage,
  setInboundFullContent,
} from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  InboundMailFoundationHandlers,
  InboundMailLastErrors,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  quarantineTable,
} from "../index.ts";
import type { DispatchWrite } from "../supervisor-ingest.ts";
import {
  adminFor,
  createMailSupervisor,
  type MailTestAdmin,
  type MailTestStack,
  rawMsg,
  setupMailStack,
  tickClock,
} from "./mail-test-support.ts";

const POLL_INTERVAL_MS = 600_000;

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
});

function failIngestOf(poisonId: string) {
  return (write: DispatchWrite): DispatchWrite =>
    (args) => {
      if (args.handlerQn === InboundMailFoundationHandlers.ingestMessage) {
        const payload = args.payload as {
          providerMessageId: string;
          contentUnavailableReason?: string;
        };
        if (
          payload.providerMessageId === poisonId &&
          payload.contentUnavailableReason === undefined
        ) {
          return Promise.resolve({ isSuccess: false, error: { code: "internal_error" } });
        }
      }
      return write(args);
    };
}

async function connectAccount(admin: MailTestAdmin, scope: "shared" | "user", address: string) {
  const result = (await env.stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Inbox",
      address,
      scope,
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

function quarantinedRows(accountId: string) {
  return selectMany(env.stack.db, quarantineTable, { accountId });
}

// Quarantines "poison" after three counted ticks; the clock moves one poll interval per tick. A good
// mail next to it proves the ingest works, otherwise the failure is an outage and never counted.
async function quarantinePoison(accountId: string, poisonId: string) {
  await seedInboundMessage(
    accountId,
    rawMsg({ providerMessageId: `${poisonId}-sibling`, text: "ok" }),
  );
  let tick = 1;
  const supervisor = createMailSupervisor(env.stack, {
    wrapWrite: failIngestOf(poisonId),
    now: () => Temporal.Instant.fromEpochMilliseconds(tick * POLL_INTERVAL_MS + 1),
  });
  for (; tick <= 3; tick++) await supervisor.pollOnce();
  expect((await quarantinedRows(accountId)).map((row) => row["providerMessageId"])).toEqual([
    poisonId,
  ]);
  return { supervisor, nextTick: () => (tick += 1) };
}

describe("who may retry", () => {
  test("the owner and a tenant admin may, another user may not", async () => {
    const owner = adminFor(6701);
    const tenantAdmin = createTestUser({
      id: 6702,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });
    const otherUser = createTestUser({ id: 6703, tenantId: owner.tenantId, roles: ["User"] });
    const accountId = await connectAccount(owner, "user", "personal@tenant.example");
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "w-poison", text: "bad" }));
    await quarantinePoison(accountId, "w-poison");
    const payload = { accountId, providerMessageId: "w-poison" };

    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      payload,
      otherUser,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
    expect((await quarantinedRows(accountId))[0]?.["retryRequestedAt"] ?? null).toBeNull();

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      payload,
      tenantAdmin,
    );
    expect((await quarantinedRows(accountId))[0]?.["retryRequestedAt"]).not.toBeNull();
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      payload,
      owner,
    );
  });

  test("a mail that is not quarantined is not found", async () => {
    const admin = adminFor(6704);
    const accountId = await connectAccount(admin, "shared", "shared@tenant.example");

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      { accountId, providerMessageId: "nope" },
      admin,
    );

    expect(JSON.stringify(error)).toContain("not_found");
  });
});

describe("the next sync reloads the mail", () => {
  test("a header-only entry gets its content attached and leaves the quarantine", async () => {
    const admin = adminFor(6710);
    const accountId = await connectAccount(admin, "shared", "attach@tenant.example");
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "r-poison", text: "bad" }));
    const { supervisor, nextTick } = await quarantinePoison(accountId, "r-poison");
    const rowId = inboundMessageAggregateId(accountId, "r-poison");
    const [header] = await selectMany(env.stack.db, inboundMessagesProjectionTable, { id: rowId });
    expect(header?.["contentState"]).toBe("unavailable");
    setInboundFullContent(
      accountId,
      rawMsg({ providerMessageId: "r-poison", text: "the full text now" }),
    );

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      { accountId, providerMessageId: "r-poison" },
      admin,
    );
    nextTick();
    await supervisor.pollOnce();

    expect(await quarantinedRows(accountId)).toEqual([]);
    const [healed] = await selectMany(env.stack.db, inboundMessagesProjectionTable, { id: rowId });
    expect(healed?.["contentState"]).toBe("complete");
    expect(healed?.["contentUnavailableReason"] ?? null).toBeNull();
  });

  test("a mail that never had an entry is ingested in full", async () => {
    const admin = adminFor(6711);
    const accountId = await connectAccount(admin, "shared", "ingest@tenant.example");
    seedRejectedInboundMessage(accountId, "u-1");
    const supervisor = createMailSupervisor(env.stack);
    await supervisor.pollOnce();
    expect(await quarantinedRows(accountId)).toHaveLength(1);
    const rowId = inboundMessageAggregateId(accountId, "u-1");
    expect(await selectMany(env.stack.db, inboundMessagesProjectionTable, { id: rowId })).toEqual(
      [],
    );
    setInboundFullContent(accountId, rawMsg({ providerMessageId: "u-1", text: "readable now" }));

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      { accountId, providerMessageId: "u-1" },
      admin,
    );
    await supervisor.pollOnce();

    expect(await quarantinedRows(accountId)).toEqual([]);
    const [row] = await selectMany(env.stack.db, inboundMessagesProjectionTable, { id: rowId });
    expect(row?.["contentState"]).toBe("complete");
  });

  test("a mail that still cannot be loaded stays quarantined and is not retried every tick", async () => {
    const admin = adminFor(6712);
    const accountId = await connectAccount(admin, "shared", "stuck@tenant.example");
    seedRejectedInboundMessage(accountId, "k-1");
    const supervisor = createMailSupervisor(env.stack);
    await supervisor.pollOnce();

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      { accountId, providerMessageId: "k-1" },
      admin,
    );
    await supervisor.pollOnce();

    const [row] = await quarantinedRows(accountId);
    expect(row?.["providerMessageId"]).toBe("k-1");
    expect(row?.["retryRequestedAt"] ?? null).toBeNull();
  });

  test("a requested retry runs although a stuck mail holds the cursor", async () => {
    const admin = adminFor(6625);
    const accountId = await connectAccount(admin, "shared", "held@tenant.example");
    seedRejectedInboundMessage(accountId, "q-1");
    const clock = tickClock();
    const supervisor = createMailSupervisor(env.stack, {
      wrapWrite: failIngestOf("q-stuck"),
      now: clock.now,
    });
    await supervisor.pollOnce();
    expect(await quarantinedRows(accountId)).toHaveLength(1);

    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "q-stuck", text: "stuck" }));
    setInboundFullContent(accountId, rawMsg({ providerMessageId: "q-1", text: "readable now" }));
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.retryQuarantinedMessage,
      { accountId, providerMessageId: "q-1" },
      admin,
    );
    clock.nextInterval();
    await supervisor.pollOnce();

    const [account] = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: accountId,
    });
    expect(account?.["lastError"]).toBe(InboundMailLastErrors.ingestUnavailable);
    expect(await quarantinedRows(accountId)).toEqual([]);
    const imported = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(imported.map((row) => row["id"])).toEqual([inboundMessageAggregateId(accountId, "q-1")]);
  });
});
