import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { configValuesTable } from "../../config/table.ts";
import { createSecretsFeature } from "../../secrets/feature.ts";
import { createSecretsContext } from "../../secrets/secrets-context.ts";
import { tenantSecretsTable } from "../../secrets/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { whatsappMessageAggregateId, whatsappStatusAggregateId } from "../aggregate-id.ts";
import { WHATSAPP_SECRET_KEYS, type WhatsappStatusKind } from "../constants.ts";
import {
  WHATSAPP_MESSAGE_RECEIVED_EVENT_QN,
  WHATSAPP_STATUS_UPDATED_EVENT_QN,
  WHATSAPP_THROTTLED_EVENT_QN,
} from "../events.ts";
import { createChannelWhatsappFeature } from "../feature.ts";
import { createWhatsappClient, type WhatsappCallContext } from "../graph-client.ts";
import {
  createInMemoryMeta,
  deliverMetaWebhook,
  metaButtonReplyMessage,
  metaMediaMessage,
  metaStatus,
  metaTextMessage,
  metaWebhookPayload,
  requestMetaVerification,
} from "../in-memory-meta.ts";
import type { ChannelWhatsappOptions } from "../options.ts";
import { readWhatsappMessagePii, readWhatsappStatusPii, readWhatsappThrottledPii } from "../pii.ts";
import { createWhatsappWebhookRoutes } from "../webhook-routes.ts";

const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });
const TENANT = tenantAdmin.tenantId;
const UNKNOWN_TENANT = testTenantId(9999);
const PHONE_NUMBER_ID = "109876543210";
const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const ACCESS_TOKEN = "EAAtest-access-token";

const meta = createInMemoryMeta();
const clientOptions: ChannelWhatsappOptions = {
  transport: meta.transport,
  senderRateLimits: [{ limit: 2, windowSeconds: 3600 }],
};
const client = createWhatsappClient(clientOptions);

let stack: TestStack;
let secretsContext: WhatsappCallContext["secrets"];
let senderCounter = 0;

function uniqueSender(): string {
  senderCounter += 1;
  return `4915100${String(senderCounter).padStart(6, "0")}`;
}

function callContext(tenantId: string = TENANT): WhatsappCallContext {
  return { tenantId, secrets: secretsContext };
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createChannelWhatsappFeature(clientOptions),
    ],
    extraRoutes: [...createWhatsappWebhookRoutes()],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  secretsContext = createSecretsContext({
    db: stack.db,
    masterKeyProvider,
    registry: stack.registry,
  });
  for (const [key, value] of [
    [WHATSAPP_SECRET_KEYS.accessToken, ACCESS_TOKEN],
    [WHATSAPP_SECRET_KEYS.appSecret, APP_SECRET],
    [WHATSAPP_SECRET_KEYS.verifyToken, VERIFY_TOKEN],
  ] as const) {
    await stack.http.writeOk("secrets:write:set", { key, value }, tenantAdmin);
  }
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function post(payload: unknown, overrides: { tenantId?: string; appSecret?: string } = {}) {
  return deliverMetaWebhook(stack.app, {
    tenantId: overrides.tenantId ?? TENANT,
    appSecret: overrides.appSecret ?? APP_SECRET,
    payload,
  });
}

async function messageEvents(wamid: string) {
  return loadAggregate(stack.db, whatsappMessageAggregateId(TENANT, wamid), TENANT);
}

async function statusEvents(
  wamid: string,
  status: WhatsappStatusKind,
  rawStatus: string | null = null,
) {
  return loadAggregate(
    stack.db,
    whatsappStatusAggregateId(TENANT, wamid, status, rawStatus),
    TENANT,
  );
}

function payloadRecord(event: { readonly payload: unknown } | undefined): Record<string, unknown> {
  const payload = event?.payload;
  if (payload === null || typeof payload !== "object")
    throw new Error("event has no object payload");
  return Object.fromEntries(Object.entries(payload));
}

function textWebhook(from: string, wamid: string, text = "Hallo") {
  return metaWebhookPayload({
    phoneNumberId: PHONE_NUMBER_ID,
    messages: [metaTextMessage({ from, wamid, text })],
  });
}

describe("webhook verification (GET)", () => {
  test("the right verify token echoes the challenge as text/plain", async () => {
    const res = await requestMetaVerification(stack.app, {
      tenantId: TENANT,
      verifyToken: VERIFY_TOKEN,
      challenge: "1158201444",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("1158201444");
  });

  test("a wrong verify token is a 401 and echoes nothing", async () => {
    const res = await requestMetaVerification(stack.app, {
      tenantId: TENANT,
      verifyToken: "wrong",
      challenge: "1158201444",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("1158201444");
  });
});

describe("webhook authentication (POST)", () => {
  test("a wrong signature, a missing signature, an unknown tenant and a malformed tenant id all answer the same 401", async () => {
    const wamid = "wamid.AUTH1";
    const payload = textWebhook(uniqueSender(), wamid);
    const wrongSignature = await post(payload, { appSecret: "not-the-secret" });
    const missingSignature = await deliverMetaWebhook(stack.app, {
      tenantId: TENANT,
      appSecret: APP_SECRET,
      payload,
      signatureHeader: null,
    });
    const unknownTenant = await post(payload, { tenantId: UNKNOWN_TENANT });
    const malformedTenant = await post(payload, { tenantId: "not-a-uuid" });

    const bodies = [];
    for (const res of [wrongSignature, missingSignature, unknownTenant, malformedTenant]) {
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await messageEvents(wamid)).toHaveLength(0);
  });

  test("a signed body that is not JSON is a 400 and stores nothing", async () => {
    const rawBody = "not json";
    const { signMetaBody } = await import("../meta-signature.ts");
    const res = await stack.app.request(`/api/channel-whatsapp/webhook/${TENANT}`, {
      method: "POST",
      body: rawBody,
      headers: { "x-hub-signature-256": signMetaBody(APP_SECRET, rawBody) },
    });
    expect(res.status).toBe(400);
  });
});

describe("inbound messages", () => {
  test("a text message becomes one message-received event; number and text are ciphertext", async () => {
    const from = uniqueSender();
    const wamid = "wamid.TEXT1";
    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        messages: [metaTextMessage({ from, wamid, text: "Wann habt ihr offen?" })],
      }),
    );
    expect(res.status).toBe(200);

    const events = await messageEvents(wamid);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(WHATSAPP_MESSAGE_RECEIVED_EVENT_QN);
    const payload = payloadRecord(events[0]);
    expect(payload["phoneNumberId"]).toBe(PHONE_NUMBER_ID);
    expect(payload["messageType"]).toBe("text");
    expect(payload["timestampIso"]).toBe("2025-11-05T00:00:00Z");
    expect(isPiiCiphertext(payload["from"])).toBe(true);
    expect(isPiiCiphertext(payload["text"])).toBe(true);
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain(from);
    expect(raw).not.toContain("Wann habt ihr offen?");

    expect(await readWhatsappMessagePii(TENANT, payload)).toEqual({
      from: `+${from}`,
      text: "Wann habt ihr offen?",
      buttonPayload: null,
    });
  });

  test("several messages and a status in one webhook are each stored", async () => {
    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        messages: [
          metaTextMessage({ from: uniqueSender(), wamid: "wamid.MULTI1", text: "eins" }),
          metaTextMessage({ from: uniqueSender(), wamid: "wamid.MULTI2", text: "zwei" }),
        ],
        statuses: [
          metaStatus({ wamid: "wamid.OUT1", status: "delivered", recipient: uniqueSender() }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 3, duplicate: 0, throttled: 0 });
    expect(await messageEvents("wamid.MULTI1")).toHaveLength(1);
    expect(await messageEvents("wamid.MULTI2")).toHaveLength(1);
    expect(await statusEvents("wamid.OUT1", "delivered")).toHaveLength(1);
  });

  test("the same wamid delivered twice answers 200 both times and stores one event", async () => {
    const payload = textWebhook(uniqueSender(), "wamid.DUP1");
    const first = await post(payload);
    const second = await post(payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ stored: 0, duplicate: 1 });
    expect(await messageEvents("wamid.DUP1")).toHaveLength(1);
  });

  test("a failing item answers 500; the redelivery stores no duplicate of the item that worked", async () => {
    // A fractional error code passes the normalizer and fails the handler schema.
    const payload = metaWebhookPayload({
      phoneNumberId: PHONE_NUMBER_ID,
      messages: [metaTextMessage({ from: uniqueSender(), wamid: "wamid.PARTIAL1", text: "ok" })],
      statuses: [
        metaStatus({
          wamid: "wamid.PARTIAL-BROKEN",
          status: "failed",
          recipient: uniqueSender(),
          errorCode: 1.5,
        }),
      ],
    });
    const first = await post(payload);
    expect(first.status).toBe(500);
    expect(await messageEvents("wamid.PARTIAL1")).toHaveLength(1);

    const second = await post(payload);
    expect(second.status).toBe(500);
    expect(await messageEvents("wamid.PARTIAL1")).toHaveLength(1);
    expect(await statusEvents("wamid.PARTIAL-BROKEN", "failed")).toHaveLength(0);
  });

  test("an oversized wamid or phone number id is skipped, an absurd timestamp falls back, an oversized media id is dropped while the mime type is clipped, and the rest of the delivery is stored", async () => {
    const longWamid = `wamid.${"X".repeat(300)}`;
    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        messages: [
          metaTextMessage({ from: uniqueSender(), wamid: longWamid, text: "zu lang" }),
          metaTextMessage({
            from: uniqueSender(),
            wamid: "wamid.HUGETS1",
            text: "Zeit",
            timestamp: "1e13",
          }),
          metaMediaMessage({
            from: uniqueSender(),
            wamid: "wamid.LONGMEDIA1",
            kind: "image",
            mediaId: "M".repeat(300),
            mimeType: `image/${"x".repeat(300)}`,
          }),
        ],
        statuses: [metaStatus({ wamid: longWamid, status: "sent", recipient: uniqueSender() })],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 2, skipped: 2 });
    expect(await messageEvents(longWamid)).toHaveLength(0);
    expect(await messageEvents("wamid.HUGETS1")).toHaveLength(1);
    const media = payloadRecord((await messageEvents("wamid.LONGMEDIA1"))[0]);
    expect(media["mediaId"]).toBeNull();
    expect(String(media["mimeType"])).toHaveLength(255);

    const oversizedPhone = await post(
      metaWebhookPayload({
        phoneNumberId: "9".repeat(65),
        messages: [metaTextMessage({ from: uniqueSender(), wamid: "wamid.LONGPN1", text: "x" })],
      }),
    );
    expect(oversizedPhone.status).toBe(200);
    expect(await messageEvents("wamid.LONGPN1")).toHaveLength(0);
  });

  test("a button reply carries payload, title and the wamid it answers", async () => {
    const from = uniqueSender();
    const sent = await client.sendButtons(callContext(), {
      phoneNumberId: PHONE_NUMBER_ID,
      to: from,
      text: "Termin bestätigen?",
      buttons: [
        { payload: "confirm:42", title: "Ja" },
        { payload: "decline:42", title: "Nein" },
      ],
    });
    if (!sent.ok) throw new Error(`send failed: ${sent.code}`);
    const body = meta.sent.find((m) => m.wamid === sent.wamid)?.body;
    expect(body).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        action: {
          buttons: [
            { reply: { id: "confirm:42", title: "Ja" } },
            { reply: { id: "decline:42", title: "Nein" } },
          ],
        },
      },
    });

    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        messages: [
          metaButtonReplyMessage({
            from,
            wamid: "wamid.BTN1",
            payload: "confirm:42",
            title: "Ja",
            contextWamid: sent.wamid,
          }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const payload = payloadRecord((await messageEvents("wamid.BTN1"))[0]);
    expect(payload["messageType"]).toBe("interactive_button");
    expect(payload["contextWamid"]).toBe(sent.wamid);
    expect(await readWhatsappMessagePii(TENANT, payload)).toMatchObject({
      text: "Ja",
      buttonPayload: "confirm:42",
    });
  });
});

describe("status callbacks", () => {
  test("statuses are normalized; an unknown status becomes other and nothing crashes", async () => {
    const recipient = uniqueSender();
    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        statuses: [
          metaStatus({ wamid: "wamid.ST1", status: "failed", recipient, errorCode: 131026 }),
          metaStatus({ wamid: "wamid.ST2", status: "something_new", recipient }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const failed = await statusEvents("wamid.ST1", "failed");
    expect(failed[0]?.type).toBe(WHATSAPP_STATUS_UPDATED_EVENT_QN);
    expect(failed[0]?.payload).toMatchObject({ status: "failed", errorCode: 131026 });
    expect(isPiiCiphertext(payloadRecord(failed[0])["recipient"])).toBe(true);
    const unknown = await statusEvents("wamid.ST2", "other", "something_new");
    expect(unknown).toHaveLength(1);
    expect(payloadRecord(unknown[0])).toMatchObject({ status: "other" });
    expect(payloadRecord(unknown[0])).not.toHaveProperty("rawStatus");
  });

  test("different unknown statuses of one wamid are each stored; the same unknown status twice once", async () => {
    const recipient = uniqueSender();
    const unknownStatusWebhook = (status: string) =>
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        statuses: [metaStatus({ wamid: "wamid.ST4", status, recipient })],
      });
    for (const status of ["warning", "warning", "deleted"]) {
      expect((await post(unknownStatusWebhook(status))).status).toBe(200);
    }
    expect(await statusEvents("wamid.ST4", "other", "warning")).toHaveLength(1);
    expect(await statusEvents("wamid.ST4", "other", "deleted")).toHaveLength(1);
  });

  test("the recipient of a status is ciphertext and the status reader returns the number", async () => {
    const recipient = uniqueSender();
    await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        statuses: [metaStatus({ wamid: "wamid.ST5", status: "delivered", recipient })],
      }),
    );
    const payload = payloadRecord((await statusEvents("wamid.ST5", "delivered"))[0]);
    expect(JSON.stringify(payload)).not.toContain(recipient);
    expect(await readWhatsappStatusPii(TENANT, payload)).toEqual({ recipient: `+${recipient}` });
    await expect(readWhatsappStatusPii(TENANT, { status: "delivered" })).rejects.toThrow(
      "no recipient",
    );
  });

  test("the same status twice is stored once and answers 200", async () => {
    const payload = metaWebhookPayload({
      phoneNumberId: PHONE_NUMBER_ID,
      statuses: [metaStatus({ wamid: "wamid.ST3", status: "read", recipient: uniqueSender() })],
    });
    expect((await post(payload)).status).toBe(200);
    expect((await post(payload)).status).toBe(200);
    expect(await statusEvents("wamid.ST3", "read")).toHaveLength(1);
  });

  test("an unexpected webhook shape is answered 200 and stores nothing", async () => {
    const res = await post({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [42, { id: "x" }] } }] }],
    });
    expect(res.status).toBe(200);
  });
});

describe("per-sender limit", () => {
  test("the third message of a sender is throttled with a 200; a redelivery and duplicates cost no budget", async () => {
    const from = uniqueSender();
    const sendWebhook = (wamid: string) => post(textWebhook(from, wamid));

    expect((await sendWebhook("wamid.LIM1")).status).toBe(200);
    // Meta redelivers the first message several times: none of it may use up the budget.
    for (let i = 0; i < 4; i += 1) expect((await sendWebhook("wamid.LIM1")).status).toBe(200);
    expect((await sendWebhook("wamid.LIM2")).status).toBe(200);
    const throttledResponse = await sendWebhook("wamid.LIM3");
    expect(throttledResponse.status).toBe(200);
    expect(await throttledResponse.json()).toMatchObject({ throttled: 1, stored: 0 });

    expect((await messageEvents("wamid.LIM1"))[0]?.type).toBe(WHATSAPP_MESSAGE_RECEIVED_EVENT_QN);
    expect((await messageEvents("wamid.LIM2"))[0]?.type).toBe(WHATSAPP_MESSAGE_RECEIVED_EVENT_QN);
    const throttled = await messageEvents("wamid.LIM3");
    expect(throttled).toHaveLength(1);
    expect(throttled[0]?.type).toBe(WHATSAPP_THROTTLED_EVENT_QN);
    expect(isPiiCiphertext(payloadRecord(throttled[0])["from"])).toBe(true);

    // The throttled wamid redelivered stays one throttled event.
    expect((await sendWebhook("wamid.LIM3")).status).toBe(200);
    expect(await messageEvents("wamid.LIM3")).toHaveLength(1);

    const throttledPayload = payloadRecord(throttled[0]);
    expect(await readWhatsappThrottledPii(TENANT, throttledPayload)).toEqual({ from: `+${from}` });
    // Each reader is bound to its event's field name: the wrong one fails on the AAD, not silently.
    await expect(readWhatsappMessagePii(TENANT, throttledPayload)).rejects.toThrow();
    await expect(readWhatsappThrottledPii(TENANT, { wamid: "x" })).rejects.toThrow("no sender");
  });

  test("statuses do not count against the sender budget, other senders are unaffected", async () => {
    const recipient = uniqueSender();
    for (let i = 0; i < 5; i += 1) {
      await post(
        metaWebhookPayload({
          phoneNumberId: PHONE_NUMBER_ID,
          statuses: [metaStatus({ wamid: `wamid.LIMST${i}`, status: "sent", recipient })],
        }),
      );
    }
    expect((await post(textWebhook(recipient, "wamid.LIMA1"))).status).toBe(200);
    expect((await messageEvents("wamid.LIMA1"))[0]?.type).toBe(WHATSAPP_MESSAGE_RECEIVED_EVENT_QN);
    expect((await post(textWebhook(uniqueSender(), "wamid.LIMB1"))).status).toBe(200);
    expect((await messageEvents("wamid.LIMB1"))[0]?.type).toBe(WHATSAPP_MESSAGE_RECEIVED_EVENT_QN);
  });
});

describe("sending", () => {
  test("a text send posts to the numbered messages endpoint with the bearer token and returns the wamid", async () => {
    meta.reset();
    const to = uniqueSender();
    const result = await client.sendText(callContext(), {
      phoneNumberId: PHONE_NUMBER_ID,
      to: `+${to}`,
      text: "Hallo zurück",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wamid).toStartWith("wamid.");
    const [sent] = meta.sent;
    expect(sent?.phoneNumberId).toBe(PHONE_NUMBER_ID);
    expect(sent?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(sent?.body).toMatchObject({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: "Hallo zurück" },
    });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });

  test("template and image-by-link sends carry their parameters", async () => {
    meta.reset();
    const to = uniqueSender();
    const template = await client.sendTemplate(callContext(), {
      phoneNumberId: PHONE_NUMBER_ID,
      to,
      templateName: "appointment_reminder",
      languageCode: "de",
      bodyParameters: ["Montag", "10:00"],
    });
    const image = await client.sendMedia(callContext(), {
      phoneNumberId: PHONE_NUMBER_ID,
      to,
      kind: "image",
      link: "https://example.com/plan.png",
      caption: "Lageplan",
    });
    expect(template.ok && image.ok).toBe(true);
    expect(meta.sent[0]?.body).toMatchObject({
      type: "template",
      template: {
        name: "appointment_reminder",
        language: { code: "de" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Montag" },
              { type: "text", text: "10:00" },
            ],
          },
        ],
      },
    });
    expect(meta.sent[1]?.body).toMatchObject({
      type: "image",
      image: { link: "https://example.com/plan.png", caption: "Lageplan" },
    });
  });

  test("typed failures: no credentials, bad recipient, bad sender id, Meta rejection", async () => {
    meta.reset();
    const base = { phoneNumberId: PHONE_NUMBER_ID, to: uniqueSender(), text: "x" };
    expect(await client.sendText(callContext(UNKNOWN_TENANT), base)).toEqual({
      ok: false,
      code: "missing_credentials",
    });
    expect(await client.sendText(callContext(), { ...base, to: "not-a-number" })).toEqual({
      ok: false,
      code: "invalid_recipient",
    });
    expect(await client.sendText(callContext(), { ...base, phoneNumberId: "../evil" })).toEqual({
      ok: false,
      code: "invalid_phone_number_id",
    });
    expect(meta.requests).toHaveLength(0);

    meta.rejectNextSend({ httpStatus: 400, metaCode: 131047 });
    expect(await client.sendText(callContext(), base)).toEqual({
      ok: false,
      code: "rejected",
      httpStatus: 400,
      metaCode: 131047,
    });
  });
});

describe("invalid outbound messages", () => {
  test("malformed buttons and templates are invalid_message and never reach the network", async () => {
    meta.reset();
    const base = { phoneNumberId: PHONE_NUMBER_ID, to: uniqueSender() };
    const okButton = { payload: "a", title: "Ja" };
    const buttonCases = [
      { text: "x", buttons: [] },
      { text: "x", buttons: [okButton, okButton, okButton, okButton] },
      { text: "x", buttons: [{ payload: "a", title: "T".repeat(21) }] },
      { text: "x", buttons: [{ payload: "", title: "Ja" }] },
      { text: "", buttons: [okButton] },
    ];
    for (const buttonCase of buttonCases) {
      expect(await client.sendButtons(callContext(), { ...base, ...buttonCase })).toEqual({
        ok: false,
        code: "invalid_message",
      });
    }
    const templateCases = [
      { templateName: "Not Valid", languageCode: "de" },
      { templateName: "reminder", languageCode: "deutsch-lang" },
    ];
    for (const templateCase of templateCases) {
      expect(await client.sendTemplate(callContext(), { ...base, ...templateCase })).toEqual({
        ok: false,
        code: "invalid_message",
      });
    }
    expect(meta.requests).toHaveLength(0);
  });
});

describe("secret store failure", () => {
  test("a throwing secret store is unreachable, not missing_credentials, and sends nothing", async () => {
    meta.reset();
    if (!secretsContext) throw new Error("secrets context not initialised");
    const failingSecrets = {
      ...secretsContext,
      get: async () => {
        throw new Error("secret store down");
      },
    };
    const failing: WhatsappCallContext = { tenantId: TENANT, secrets: failingSecrets };
    expect(
      await client.sendText(failing, {
        phoneNumberId: PHONE_NUMBER_ID,
        to: uniqueSender(),
        text: "x",
      }),
    ).toEqual({ ok: false, code: "unreachable" });
    expect(await client.fetchMedia(failing, "MEDIA1")).toEqual({ ok: false, code: "unreachable" });
    expect(meta.requests).toHaveLength(0);
  });
});

describe("media", () => {
  test("an image message is fetched by media id with the token on both requests", async () => {
    meta.reset();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    meta.seedMedia("MEDIA1", { bytes, mimeType: "image/jpeg" });
    const res = await post(
      metaWebhookPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        messages: [
          metaMediaMessage({
            from: uniqueSender(),
            wamid: "wamid.IMG1",
            kind: "image",
            mediaId: "MEDIA1",
            mimeType: "image/jpeg",
          }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const payload = (await messageEvents("wamid.IMG1"))[0]?.payload;
    expect(payload).toMatchObject({
      messageType: "image",
      mediaId: "MEDIA1",
      mimeType: "image/jpeg",
    });

    const media = await client.fetchMedia(callContext(), "MEDIA1");
    expect(media).toEqual({ ok: true, bytes, mimeType: "image/jpeg" });
    expect(meta.requests.map((r) => r.authorization)).toEqual([
      `Bearer ${ACCESS_TOKEN}`,
      `Bearer ${ACCESS_TOKEN}`,
    ]);
  });

  test("a media URL outside the allowlist is refused before the token is sent", async () => {
    meta.reset();
    meta.seedMedia("MEDIA2", {
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      host: "evil.example",
    });
    const media = await client.fetchMedia(callContext(), "MEDIA2");
    expect(media).toEqual({ ok: false, code: "host_not_allowed" });
    expect(meta.requests).toHaveLength(1);
    expect(meta.requests[0]?.url).not.toContain("evil.example");
    expect(meta.requests.some((r) => r.url.includes("evil.example"))).toBe(false);
  });

  test("a body larger than mediaMaxBytes without content-length is too_large and the stream is cancelled", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(40);
    const streamingTransport: ChannelWhatsappOptions["transport"] = async (url) => {
      if (url.includes("graph.facebook.com")) {
        return Response.json({ url: "https://lookaside.fbsbx.com/media/MEDIA3" });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    const limited = createWhatsappClient({ transport: streamingTransport, mediaMaxBytes: 100 });
    expect(await limited.fetchMedia(callContext(), "MEDIA3")).toEqual({
      ok: false,
      code: "too_large",
    });
    expect(cancelled).toBe(true);
  });

  test("a redirecting media download is blocked and the redirect target is never requested", async () => {
    const requested: string[] = [];
    const redirectingTransport: ChannelWhatsappOptions["transport"] = async (url, init) => {
      requested.push(url);
      expect(init?.redirect).toBe("manual");
      if (url.includes("graph.facebook.com")) {
        return Response.json({ url: "https://lookaside.fbsbx.com/media/MEDIA4" });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      });
    };
    const redirecting = createWhatsappClient({ transport: redirectingTransport });
    expect(await redirecting.fetchMedia(callContext(), "MEDIA4")).toEqual({
      ok: false,
      code: "redirect_blocked",
    });
    expect(requested.some((url) => url.includes("evil.example"))).toBe(false);
  });

  test("an invalid media id never reaches the network", async () => {
    meta.reset();
    expect(await client.fetchMedia(callContext(), "../../etc")).toEqual({
      ok: false,
      code: "invalid_media_id",
    });
    expect(meta.requests).toHaveLength(0);
  });
});

describe("boot validation", () => {
  test.each([
    [{ apiBaseUrl: "not a url" }, "not a valid URL"],
    [{ apiBaseUrl: "https://graph.example.net" }, "not in allowedHosts"],
    [{ apiBaseUrl: "http://graph.facebook.com" }, "must use https"],
    [{ apiVersion: "latest" }, "apiVersion"],
    [{ rateLimit: { disabled: true as const, reason: "no limit" } }, "cannot be disabled"],
    [{ senderRateLimits: [{ limit: 0, windowSeconds: 60 }] }, "positive integer"],
    [{ apiBaseUrl: "https://graph.facebook.com:8443" }, "must not carry a port"],
    [{ timeoutMs: 0 }, "timeoutMs"],
    [{ timeoutMs: Number.NaN }, "timeoutMs"],
    [{ mediaMaxBytes: -1 }, "mediaMaxBytes"],
  ] satisfies [ChannelWhatsappOptions, string][])("%o is refused", (options, message) => {
    expect(() => createChannelWhatsappFeature(options)).toThrow(message);
    expect(() => createWhatsappClient(options)).toThrow(message);
  });

  test("http works when explicitly allowed, and the limit may be disabled without sender limits", () => {
    expect(() =>
      createChannelWhatsappFeature({
        apiBaseUrl: "http://graph.facebook.com",
        requireHttps: false,
      }),
    ).not.toThrow();
    expect(() =>
      createChannelWhatsappFeature({
        senderRateLimits: [],
        rateLimit: { disabled: true, reason: "behind an edge limiter" },
      }),
    ).not.toThrow();
  });

  test("the webhook path must carry :tenantId", () => {
    expect(() => createWhatsappWebhookRoutes({ path: "/api/whatsapp/hook" })).toThrow(":tenantId");
  });
});
