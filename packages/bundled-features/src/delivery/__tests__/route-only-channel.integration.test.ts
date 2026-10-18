import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createChannelSlackFeature } from "../../channel-slack/feature.ts";
import { collectChannels, createDeliveryService } from "../delivery-service.ts";
import { deliveryAttemptsTable } from "../tables.ts";
import { isDeliveryChannelPlugin } from "../types.ts";
import { type ChatHarness, setupChatHarness } from "./chat-channel-harness.ts";

let harness: ChatHarness;

beforeAll(async () => {
  harness = await setupChatHarness(createChannelSlackFeature());
});

afterAll(async () => {
  await harness.cleanup();
});

describe("channels without resolve", () => {
  test("a plugin without resolve is a valid delivery channel", () => {
    expect(
      isDeliveryChannelPlugin({ mode: "queued", send: async () => ({ status: "sent" }) }),
    ).toBe(true);
  });

  test("deliverToUser skips a route-only channel without writing any row", async () => {
    const { db, registry } = harness.stack;
    const service = createDeliveryService({ db, registry, channels: collectChannels(registry) });
    const admin = TestUsers.admin;
    const notificationType = "app:notify:route-only-skip";

    await service.notify(
      notificationType,
      { to: "42", data: { title: "hello" } },
      admin,
      admin.tenantId,
    );

    const rows = await selectMany(db, deliveryAttemptsTable, { notificationType });
    expect(rows).toHaveLength(0);
  });
});
