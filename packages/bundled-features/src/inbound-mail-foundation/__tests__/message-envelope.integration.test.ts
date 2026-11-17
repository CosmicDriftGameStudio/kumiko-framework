// loadInboundMessageEnvelope decrypts one mail for server-side consumers with the visibility of
// message:content, plus the system user, and hides mails whose tenant key was erased.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { loadInboundMessageEnvelope } from "../handlers/message-envelope.ts";
import { InboundMailFoundationHandlers } from "../index.ts";
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
  patchFileInstanceofForBunTest();
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

function envelopeAs(
  user: ReturnType<typeof createTestUser>,
  accountId: string,
  providerMessageId: string,
) {
  return loadInboundMessageEnvelope(
    { db: createTenantDb({ db: env.stack.db, tenantId: user.tenantId }), user },
    inboundMessageAggregateId(accountId, providerMessageId),
  );
}

describe("loadInboundMessageEnvelope", () => {
  test("shared mailbox: returns the decrypted envelope, null for an unknown id", async () => {
    const admin = adminFor(6901);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "env-1" }));
    await createMailSupervisor(env.stack).pollOnce();

    const envelope = await envelopeAs(admin, accountId, "env-1");

    expect(envelope).toMatchObject({
      from: "sender@example.com",
      to: ["inbox@tenant.example"],
      subject: "Subject env-1",
      snippet: "snippet",
      ownerUserId: null,
    });
    const unknown = await loadInboundMessageEnvelope(
      { db: createTenantDb({ db: env.stack.db, tenantId: admin.tenantId }), user: admin },
      "00000000-0000-4000-8000-000000000999",
    );
    expect(unknown).toBeNull();
  });

  test("personal mailbox: owner and system user read it, a tenant admin does not", async () => {
    const connector = adminFor(6902);
    const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Mine",
        address: "mine@tenant.example",
        scope: "user",
      },
      connector,
    );
    const owner = createTestUser({
      id: connector.id,
      tenantId: connector.tenantId,
      roles: ["User"],
    });
    const tenantAdmin = createTestUser({
      id: 6903,
      tenantId: connector.tenantId,
      roles: ["TenantAdmin"],
    });
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "env-personal" }));
    await createMailSupervisor(env.stack).pollOnce();

    expect((await envelopeAs(owner, accountId, "env-personal"))?.ownerUserId).toBe(connector.id);
    expect(await envelopeAs(tenantAdmin, accountId, "env-personal")).toBeNull();
    const asSystem = await envelopeAs(
      createSystemUser(connector.tenantId),
      accountId,
      "env-personal",
    );
    expect(asSystem?.from).toBe("sender@example.com");
  });

  test("an erased tenant key hides the mail", async () => {
    const admin = adminFor(6904);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "env-erase" }));
    await createMailSupervisor(env.stack).pollOnce();
    expect(await envelopeAs(admin, accountId, "env-erase")).not.toBeNull();

    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    await kms.eraseKey(
      { kind: "tenant", tenantId: admin.tenantId },
      { requestId: "test:envelope-erase", eraseReason: "test" },
    );

    expect(await envelopeAs(admin, accountId, "env-erase")).toBeNull();
  });
});
