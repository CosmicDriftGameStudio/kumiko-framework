// An app that names its own roles (a property manager app, say): the mail handlers answer to those
// roles instead of "User" and "TenantAdmin", through the whole stack including the file download.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { ImapHandlers } from "../../inbound-provider-imap/constants.ts";
import { createInboundProviderImapFeature } from "../../inbound-provider-imap/feature.ts";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { INBOUND_MAIL_FOUNDATION_FEATURE } from "../constants.ts";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../index.ts";
import {
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
} from "./mail-test-support.ts";

const ROLES = { userRoles: ["PropertyManager"], adminRoles: ["Admin"] } as const;
const TENANT = 6901;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 configured roles");
const MESSAGE_DETAIL = `${INBOUND_MAIL_FOUNDATION_FEATURE}:query:${INBOUND_MESSAGE_AGGREGATE_TYPE}:detail`;

let env: MailTestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  env = await setupMailStack({
    withFiles: true,
    roles: ROLES,
    extraFeatures: [createInboundProviderImapFeature(ROLES)],
  });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

function userWith(id: number, roles: string[]) {
  return createTestUser({ id, tenantId: testTenantId(TENANT), roles });
}

const admin = () => userWith(TENANT, ["Admin"]);
const manager = () => userWith(TENANT + 1, ["PropertyManager"]);
const plainUser = () => userWith(TENANT + 2, ["User"]);
const legacyTenantAdmin = () => userWith(TENANT + 3, ["TenantAdmin"]);

async function sharedMailWithAttachment(address: string) {
  const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team",
      address,
      scope: "shared",
    },
    admin(),
  );
  await seedInboundMessage(
    accountId,
    rawMsg({
      providerMessageId: "cfg-1",
      text: "hello",
      attachments: [{ fileName: "plan.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    }),
  );
  await createMailSupervisor(env.stack).pollOnce();
  return { accountId, messageId: inboundMessageAggregateId(accountId, "cfg-1") };
}

describe("mail with configured roles", () => {
  test("a member role reads shared mail, a bare User is denied", async () => {
    const { accountId, messageId } = await sharedMailWithAttachment("read@tenant.example");

    const list = await env.stack.http.queryOk<{ rows: unknown[] }>(
      InboundMailFoundationQueries.listMessages,
      { accountId },
      manager(),
    );
    expect(list.rows).toHaveLength(1);
    const detail = await env.stack.http.queryOk<{ id: string } | null>(
      MESSAGE_DETAIL,
      { id: messageId },
      manager(),
    );
    expect(detail?.id).toBe(messageId);
    const content = await env.stack.http.queryOk<{ attachmentFileIds: string[] } | null>(
      InboundMailFoundationQueries.messageContent,
      { messageId },
      manager(),
    );
    const fileId = content?.attachmentFileIds[0];
    if (fileId === undefined) throw new Error("expected the imported attachment");
    const token = await env.stack.jwt.sign(manager());
    const download = await env.stack.app.request(`/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);

    for (const query of [
      [InboundMailFoundationQueries.listMessages, { accountId }],
      [InboundMailFoundationQueries.messageContent, { messageId }],
      [MESSAGE_DETAIL, { id: messageId }],
    ] as const) {
      const denied = await env.stack.http.queryErr(query[0], query[1], plainUser());
      expect(denied.httpStatus).toBe(403);
    }
  });

  test("the configured admin role manages mailboxes, the default TenantAdmin does not", async () => {
    const { accountId } = await sharedMailWithAttachment("manage@tenant.example");

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, displayName: "Renamed" },
      admin(),
    );
    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, displayName: "Nope" },
      legacyTenantAdmin(),
    );
    expect(denied.httpStatus).toBe(403);
    const deniedConnect = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "x",
        address: "x@tenant.example",
        scope: "shared",
      },
      legacyTenantAdmin(),
    );
    expect(deniedConnect.httpStatus).toBe(403);
    const deniedImap = await env.stack.http.writeErr(
      ImapHandlers.connectMailbox,
      {},
      legacyTenantAdmin(),
    );
    expect(deniedImap.httpStatus).toBe(403);
    const deniedMember = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      manager(),
    );
    expect(deniedMember.httpStatus).toBe(403);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin(),
    );
  });
});
