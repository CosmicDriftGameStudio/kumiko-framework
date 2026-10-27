// What a downstream job sees of the content-fetched event: enough to rebuild the mail's stream id
// (accountId plus the providerMessageId header) and to know whose mail it is, for both the shared
// and the personal mailbox, without reading the mail itself.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature, type JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  resetInboundInMemory,
  setInboundFullContent,
} from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers } from "../constants.ts";
import { INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN } from "../events.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
} from "./mail-test-support.ts";

type Seen = {
  readonly payload: Record<string, unknown>;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly eventId: string | undefined;
};

const seen: Seen[] = [];

const subscriberFeature = defineFeature("content-fetched-subscriber", (r) => {
  r.job(
    "on-content-fetched",
    { trigger: { on: INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN }, runIn: "worker" },
    async (payload, ctx: JobContext) => {
      seen.push({
        payload,
        headers: ctx.triggerEvent?.headers ?? {},
        eventId: ctx.triggerEvent?.id,
      });
    },
  );
});

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({
    withFiles: true,
    extraFeatures: [subscriberFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  seen.length = 0;
  resetInboundInMemory();
});

async function ingestSnippetOnly(
  admin: ReturnType<typeof adminFor>,
  accountId: string,
  ownerUserId: string | null,
  providerMessageId: string,
) {
  await env.stack.http.writeOk(
    InboundMailFoundationHandlers.ingestMessage,
    {
      accountId,
      ownerUserId,
      providerName: "inmemory",
      providerMessageId,
      messageIdHeader: `${providerMessageId}@example.com`,
      providerThreadId: null,
      references: [],
      from: "sender@example.com",
      to: ["inbox@tenant.example"],
      cc: [],
      subject: "Old import",
      snippet: "only the snippet",
      receivedAtIso: Temporal.Now.instant().toString(),
      bodyRef: "",
      scope: ownerUserId === null ? "inbox" : "user",
      providerCursor: '{"offset":0}',
    },
    admin,
  );
}

// The job only gets the trigger event's id, so the stream is rebuilt from the payload and header.
async function storedFetchEventId(tenantId: string, accountId: string, providerMessageId: string) {
  const stream = await loadAggregate(
    env.stack.db,
    inboundMessageAggregateId(accountId, providerMessageId),
    tenantId,
  );
  return stream.find((stored) => stored.type === INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN)?.id;
}

describe("content-fetched subscriber", () => {
  test("a refetch of a shared mail tells the job the account, no owner, and the message key", async () => {
    const admin = adminFor(6951);
    const accountId = await connectInMemoryAccount(env.stack, admin, "shared-sub@tenant.example");
    await ingestSnippetOnly(admin, accountId, null, "sub-shared");
    setInboundFullContent(
      accountId,
      rawMsg({ providerMessageId: "sub-shared", text: "the complete text" }),
    );

    await createMailSupervisor(env.stack).pollOnce();
    await env.stack.drainJobs();

    expect(seen).toHaveLength(1);
    const [event] = seen;
    expect(event?.payload).toMatchObject({ accountId, ownerUserId: null });
    expect(event?.headers["providerMessageId"]).toBe("sub-shared");
    expect(await storedFetchEventId(admin.tenantId, accountId, "sub-shared")).toBe(event?.eventId);
  });

  test("a refetch of a personal mail names the owner and the attachment files", async () => {
    const owner = createTestUser({
      id: 6952,
      tenantId: adminFor(6952).tenantId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Mine",
        address: "mine-sub@tenant.example",
        scope: "user",
      },
      owner,
    );
    await ingestSnippetOnly(owner, accountId, owner.id, "sub-personal");
    setInboundFullContent(
      accountId,
      rawMsg({
        providerMessageId: "sub-personal",
        text: "private text",
        attachments: [
          {
            fileName: "a.pdf",
            mimeType: "application/pdf",
            data: new TextEncoder().encode("%PDF-1.4 sub"),
          },
        ],
      }),
    );

    await createMailSupervisor(env.stack).pollOnce();
    await env.stack.drainJobs();

    expect(seen).toHaveLength(1);
    const [event] = seen;
    expect(event?.payload).toMatchObject({ accountId, ownerUserId: owner.id });
    expect(event?.payload["attachmentFileIds"]).toHaveLength(1);
    expect(event?.headers["providerMessageId"]).toBe("sub-personal");
    expect(await storedFetchEventId(owner.tenantId, accountId, "sub-personal")).toBe(
      event?.eventId,
    );
  });
});
