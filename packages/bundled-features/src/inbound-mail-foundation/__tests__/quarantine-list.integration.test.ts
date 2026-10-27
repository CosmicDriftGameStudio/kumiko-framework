// The quarantine list: open entries of the mailboxes the caller may manage, with sender and subject
// from the header-only import (null where the provider gave no headers), acknowledged one by one,
// and the row actions of the screen wired to real handlers.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  resetInboundInMemory,
  seedInboundMessage,
  seedRejectedInboundMessage,
} from "../../inbound-provider-inmemory/index.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../constants.ts";
import { INBOUND_MAIL_FOUNDATION_I18N } from "../i18n.ts";
import { QUARANTINE_REASON_CODES } from "../quarantine-entities.ts";
import {
  mailQuarantineScreen,
  QUARANTINE_REASON_OPTION_KEY_PREFIX,
} from "../quarantine-screens.ts";
import { mailAccountListScreen } from "../screens.ts";
import type { DispatchWrite } from "../supervisor-ingest.ts";
import {
  adminFor,
  createMailSupervisor,
  type MailTestAdmin,
  type MailTestStack,
  rawMsg,
  setupMailStack,
} from "./mail-test-support.ts";

const POLL_INTERVAL_MS = 600_000;

type QuarantineRow = {
  readonly accountId: string;
  readonly providerMessageId: string;
  readonly reason: string;
  readonly retryRequestedAt: string | null;
  readonly sender: string | null;
  readonly subject: string | null;
};

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

async function connect(admin: MailTestAdmin, scope: "shared" | "user", address: string) {
  const result = (await env.stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    { provider: "inmemory", authMethod: "password", displayName: "Inbox", address, scope },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

// One mail quarantined as poison (header-only import follows) and one the provider rejected without
// headers. The good mail next to the poison one proves the ingest works, so its failure is counted.
async function quarantineTwo(accountId: string) {
  await seedInboundMessage(accountId, rawMsg({ providerMessageId: "p-1", text: "bad" }));
  await seedInboundMessage(accountId, rawMsg({ providerMessageId: "p-2", text: "good" }));
  let tick = 1;
  const supervisor = createMailSupervisor(env.stack, {
    wrapWrite: failIngestOf("p-1"),
    now: () => Temporal.Instant.fromEpochMilliseconds(tick * POLL_INTERVAL_MS + 1),
  });
  for (; tick <= 3; tick++) await supervisor.pollOnce();
  seedRejectedInboundMessage(accountId, "u-1");
  tick += 1;
  await supervisor.pollOnce();
}

async function listFor(user: MailTestAdmin, accountId?: string): Promise<QuarantineRow[]> {
  const { rows } = await env.stack.http.queryOk<{ rows: QuarantineRow[] }>(
    InboundMailFoundationQueries.listQuarantine,
    accountId === undefined ? {} : { accountId },
    user,
  );
  return rows;
}

describe("quarantine:list", () => {
  test("rows carry sender and subject from the header import, null without one", async () => {
    const admin = adminFor(6801);
    const accountId = await connect(admin, "shared", "list@tenant.example");
    await quarantineTwo(accountId);

    const rows = await listFor(admin, accountId);

    expect(rows.map((row) => row.providerMessageId).sort()).toEqual(["p-1", "u-1"]);
    expect(rows.find((row) => row.providerMessageId === "p-1")).toEqual(
      expect.objectContaining({
        sender: "sender@example.com",
        subject: "Subject p-1",
        reason: "ingest_failed",
        retryRequestedAt: null,
      }),
    );
    expect(rows.find((row) => row.providerMessageId === "u-1")).toEqual(
      expect.objectContaining({ sender: null, subject: null }),
    );
  });

  test("a user who does not own the personal mailbox sees nothing, an admin does", async () => {
    const owner = adminFor(6802);
    const stranger = createTestUser({ id: 6803, tenantId: owner.tenantId, roles: ["User"] });
    const tenantAdmin = createTestUser({
      id: 6804,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });
    const accountId = await connect(owner, "user", "mine@tenant.example");
    seedRejectedInboundMessage(accountId, "u-1");
    await createMailSupervisor(env.stack).pollOnce();

    expect(await listFor(stranger)).toEqual([]);
    expect(await listFor(stranger, accountId)).toEqual([]);
    expect(await listFor(tenantAdmin, accountId)).toHaveLength(1);
    expect(await listFor(owner, accountId)).toHaveLength(1);
  });

  test("acknowledging one row leaves the other open, and a stranger may not", async () => {
    const admin = adminFor(6805);
    const stranger = createTestUser({ id: 6806, tenantId: admin.tenantId, roles: ["User"] });
    const accountId = await connect(admin, "user", "ack@tenant.example");
    await quarantineTwo(accountId);

    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.acknowledgeQuarantine,
      { accountId, providerMessageId: "u-1" },
      stranger,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.acknowledgeQuarantine,
      { accountId, providerMessageId: "u-1" },
      admin,
    );

    expect((await listFor(admin, accountId)).map((row) => row.providerMessageId)).toEqual(["p-1"]);
  });

  test("retry flags the row and the screen then hides the retry action for it", async () => {
    const admin = adminFor(6807);
    const accountId = await connect(admin, "shared", "retry@tenant.example");
    seedRejectedInboundMessage(accountId, "u-1");
    await createMailSupervisor(env.stack).pollOnce();

    const retry = mailQuarantineScreen.rowActions?.find((action) => action.id === "retry");
    if (
      retry?.kind !== "writeHandler" ||
      retry.payload === undefined ||
      !("map" in retry.payload)
    ) {
      throw new Error("expected the retry row action to map row fields into the payload");
    }
    const [row] = await listFor(admin, accountId);
    if (row === undefined) throw new Error("expected one quarantine row");
    await env.stack.http.writeOk(
      retry.handler,
      Object.fromEntries(
        Object.entries(retry.payload.map).map(([target, source]) => [
          target,
          (row as Record<string, unknown>)[source],
        ]),
      ),
      admin,
    );

    const [flagged] = await listFor(admin, accountId);
    expect(flagged?.retryRequestedAt).not.toBeNull();
    expect(retry.visible).toEqual({ field: "retryRequestedAt", eq: null });
  });
});

describe("quarantine screen", () => {
  test("lists sender, subject, reason and date, with a translated reason per code", () => {
    expect(
      mailQuarantineScreen.columns.map((column) =>
        typeof column === "string" ? column : column.field,
      ),
    ).toEqual(["sender", "subject", "reason", "accountName", "quarantinedAt"]);
    for (const code of QUARANTINE_REASON_CODES) {
      expect(INBOUND_MAIL_FOUNDATION_I18N).toHaveProperty([
        `${QUARANTINE_REASON_OPTION_KEY_PREFIX}${code}`,
      ]);
    }
    expect(mailQuarantineScreen.rowActions?.map((action) => action.id)).toEqual([
      "retry",
      "acknowledge",
    ]);
  });

  test("the mailbox list opens it only for a mailbox with open quarantine", () => {
    const action = mailAccountListScreen.rowActions?.find(
      (candidate) => candidate.id === "quarantine",
    );
    expect(action).toEqual(
      expect.objectContaining({
        kind: "navigate",
        screen: mailQuarantineScreen.id,
        visible: { field: "hasOpenQuarantine", eq: true },
      }),
    );
  });
});
