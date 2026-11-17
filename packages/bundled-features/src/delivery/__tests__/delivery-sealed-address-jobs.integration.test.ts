// Queued delivery jobs must not carry the recipient address or the message content in plaintext
// when the app has a master key: the payloads sit in Redis and the job-run table. Both are sealed
// at dispatch and opened only inside the send job.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type JobContext,
  type NotifyJobDispatcher,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.ts";
import { collectChannels, createDeliveryService } from "../delivery-service.ts";
import { sealJobContent } from "../job-content-seal.ts";
import { deliverySendJob } from "../jobs.ts";
import { deliveryAttemptsTable } from "../tables.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

const CHANNEL = "sealed-probe";
const ADDRESS = "alice.sealed@example.com";
const TITLE = "Sealed-Title";
const BODY = "Sealed-Body";
const ORDER_REF = "Sealed-Ref";
const OTHER_TENANT_ADDRESS = "bob.other-tenant@example.com";
const OTHER_TENANT = testTenantId(99);

const sentTo: string[] = [];

const sealedProbeFeature = defineFeature("sealed-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, CHANNEL, {
    mode: "queued",
    render: async () => ({ html: "<p>x</p>", subject: "x" }),
    send: async (address: string) => {
      sentTo.push(address);
      return { status: "sent" };
    },
  });
});

type Dispatched = { name: string; payload: Record<string, unknown> };

let harness: ChatHarness;
const cipher = createTestEnvelopeCipher();
let notificationCounter = 0;

beforeAll(async () => {
  harness = await setupChatHarness(sealedProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

function recordingRunner(into: Dispatched[]): NotifyJobDispatcher {
  return {
    async dispatch(name, payload) {
      into.push({ name, payload });
      return "stub-job-id";
    },
  };
}

function withoutConfigEncryption(services: JobContext["services"]): JobContext["services"] {
  const { configEncryption: _sealedWith, ...rest } = services;
  return rest;
}

type LoggedJobContext = { readonly ctx: JobContext; readonly logged: string[] };

function jobContext(
  runner: NotifyJobDispatcher,
  jobCipher: typeof cipher | undefined,
): LoggedJobContext {
  const logged: string[] = [];
  const log: Logger = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: (message) => {
      logged.push(message);
    },
    child: () => log,
  };
  const base = harness.buildJobContext(runner);
  const ctx: JobContext = {
    ...base,
    obs: { ...base.obs, log },
    // The harness job context carries a cipher; a job without one must really have none.
    services: {
      ...withoutConfigEncryption(base.services),
      ...(jobCipher && { configEncryption: jobCipher }),
    },
  };
  return { ctx, logged };
}

async function notifyThroughService(
  addressCipher: typeof cipher | undefined,
): Promise<{ dispatched: Dispatched[]; notificationType: string }> {
  const dispatched: Dispatched[] = [];
  const service = createDeliveryService({
    db: harness.stack.db,
    registry: harness.stack.registry,
    channels: collectChannels(harness.stack.registry),
    jobRunner: recordingRunner(dispatched),
    ...(addressCipher && { addressCipher }),
  });
  const notificationType = `app:notify:sealed-${notificationCounter++}`;
  await service.notify(
    notificationType,
    { route: { [CHANNEL]: ADDRESS }, data: { title: TITLE, body: BODY, orderRef: ORDER_REF } },
    tenantAdmin,
    tenantAdmin.tenantId,
  );
  return { dispatched, notificationType };
}

describe("delivery jobs with a master key", () => {
  test("the send payload carries neither address nor message content in plaintext and the channel still gets the address", async () => {
    sentTo.length = 0;
    const { dispatched, notificationType } = await notifyThroughService(cipher);

    expect(dispatched).toHaveLength(1);
    const sendJob = dispatched[0];
    if (!sendJob) throw new Error("send job not dispatched");
    expect(sendJob.name).toBe(DeliveryJobs.send);
    const serialized = JSON.stringify(sendJob.payload);
    for (const secret of [ADDRESS, TITLE, BODY, ORDER_REF]) {
      expect(serialized).not.toContain(secret);
    }
    expect(sendJob.payload).not.toHaveProperty("content");
    expect(sendJob.payload).not.toHaveProperty("address");
    expect(sendJob.payload).not.toHaveProperty("message");
    expect(typeof sendJob.payload["sealedContent"]).toBe("string");

    const { ctx } = jobContext(recordingRunner([]), cipher);
    await deliverySendJob(sendJob.payload, ctx);
    expect(sentTo).toEqual([ADDRESS]);

    const rows = await selectMany<{ status: string }>(harness.stack.db, deliveryAttemptsTable, {
      notificationType,
    });
    expect(rows.map((row) => row.status)).toEqual(["sent"]);
  });

  test("a sealed payload without a cipher fails the attempt and leaks no address", async () => {
    sentTo.length = 0;
    const { dispatched, notificationType } = await notifyThroughService(cipher);
    const sealedPayload = dispatched[0]?.payload;
    if (!sealedPayload) throw new Error("send job not dispatched");

    const { ctx, logged } = jobContext(recordingRunner([]), undefined);
    const failure = await deliverySendJob(sealedPayload, ctx).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error && failure.message).toBe("send_failed");
    expect(sentTo).toEqual([]);
    expect(logged.join("\n")).not.toContain(ADDRESS);
    const rows = await selectMany<{
      status: string;
      error: string | null;
      recipientAddress: unknown;
    }>(harness.stack.db, deliveryAttemptsTable, { notificationType });
    expect(rows.map((row) => row.status)).toEqual(["failed"]);
    expect(rows[0]?.error).toBe("send_failed");
    expect(JSON.stringify(rows)).not.toContain(ADDRESS);
  });

  test("a same-tenant ciphertext sealed for another purpose is not decrypted into a send", async () => {
    sentTo.length = 0;
    const { dispatched, notificationType } = await notifyThroughService(cipher);
    const sealedPayload = dispatched[0]?.payload;
    if (!sealedPayload) throw new Error("send job not dispatched");
    const foreignSecret = "iban-DE00-foreign-pii-field";
    const foreignCiphertext = await cipher.encrypt(foreignSecret, {
      tenantId: tenantAdmin.tenantId,
    });

    const { ctx, logged } = jobContext(recordingRunner([]), cipher);
    const failure = await deliverySendJob(
      { ...sealedPayload, sealedContent: foreignCiphertext },
      ctx,
    ).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(failure instanceof Error && failure.message).toBe("send_failed");
    expect(sentTo).toEqual([]);
    expect(logged.join("\n")).not.toContain(foreignSecret);
    const rows = await selectMany<{ status: string }>(harness.stack.db, deliveryAttemptsTable, {
      notificationType,
    });
    expect(rows.map((row) => row.status)).toEqual(["failed"]);
    expect(JSON.stringify(rows)).not.toContain(foreignSecret);
  });

  test("sealed content of another tenant is not opened inside this tenant's job", async () => {
    sentTo.length = 0;
    const { dispatched, notificationType } = await notifyThroughService(cipher);
    const sealedPayload = dispatched[0]?.payload;
    if (!sealedPayload) throw new Error("send job not dispatched");
    const otherTenantSeal = await sealJobContent(
      {
        address: OTHER_TENANT_ADDRESS,
        message: { notificationType: "app:notify:sealed-other", title: "Other" },
      },
      OTHER_TENANT,
      cipher,
    );

    const { ctx, logged } = jobContext(recordingRunner([]), cipher);
    const failure = await deliverySendJob(
      { ...sealedPayload, sealedContent: otherTenantSeal.sealedContent },
      ctx,
    ).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(failure instanceof Error && failure.message).toBe("send_failed");
    expect(sentTo).toEqual([]);
    expect(logged.join("\n")).not.toContain(OTHER_TENANT_ADDRESS);
    const rows = await selectMany<{ status: string }>(harness.stack.db, deliveryAttemptsTable, {
      notificationType,
    });
    expect(rows.map((row) => row.status)).toEqual(["failed"]);
    expect(JSON.stringify(rows)).not.toContain(OTHER_TENANT_ADDRESS);
  });
});

describe("delivery jobs without a master key", () => {
  test("without an address cipher no job is dispatched and the channel sends inline", async () => {
    sentTo.length = 0;
    const { dispatched } = await notifyThroughService(undefined);
    expect(dispatched).toEqual([]);
    expect(sentTo).toEqual([ADDRESS]);
  });
});

describe("delivery job payload shape", () => {
  test("a payload with both content and sealedContent, or neither, is rejected", async () => {
    const content = {
      address: ADDRESS,
      message: { notificationType: "app:notify:sealed-invalid", title: "Invalid" },
    };
    const base = {
      channelName: CHANNEL,
      tenantId: tenantAdmin.tenantId,
      recipientId: null,
      notificationType: "app:notify:sealed-invalid",
      deliveryAttemptId: "00000000-0000-4000-8000-0000000000e3",
      priority: "normal",
    };
    const { ctx } = jobContext(recordingRunner([]), cipher);
    await expect(
      deliverySendJob({ ...base, content, sealedContent: "x" }, ctx),
    ).rejects.toThrow();
    await expect(deliverySendJob(base, ctx)).rejects.toThrow();
  });
});
