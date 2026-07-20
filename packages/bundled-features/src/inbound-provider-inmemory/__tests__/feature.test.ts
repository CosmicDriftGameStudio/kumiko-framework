import { describe, expect, test } from "bun:test";
import { describeInboundMailProviderContract } from "../../inbound-mail-foundation/__tests__/inbound-mail-provider-contract";
import {
  inboundProviderInMemoryFeature,
  inMemoryInboundMailPlugin,
  seedInboundMessage,
} from "../feature";

describe("inboundProviderInMemoryFeature — shape", () => {
  test("has the expected name + requirement", () => {
    expect(inboundProviderInMemoryFeature.name).toBe("inbound-provider-inmemory");
    expect(inboundProviderInMemoryFeature.requires).toContain("inbound-mail-foundation");
  });
});

describeInboundMailProviderContract("inmemory", () => {
  const accountId = crypto.randomUUID();
  return {
    plugin: inMemoryInboundMailPlugin,
    ctx: {},
    account: {
      id: accountId,
      tenantId: "00000000-0000-4000-8000-000000004242",
      provider: "inmemory",
      authMethod: "password",
      ownerUserId: null,
      address: "contract@example.com",
      displayName: "Contract-Test",
      status: "active",
      watchState: "idle",
    },
    seed: (subject) =>
      seedInboundMessage(accountId, {
        providerMessageId: crypto.randomUUID(),
        messageIdHeader: null,
        providerThreadId: null,
        references: [],
        from: "sender@example.com",
        to: ["contract@example.com"],
        cc: [],
        subject,
        snippet: subject,
        receivedAtIso: "2026-07-01T10:00:00Z",
        rawMime: null,
        scope: "inbox",
      }),
  };
});
