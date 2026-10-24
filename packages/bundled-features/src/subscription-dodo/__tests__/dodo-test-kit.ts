// Shared fixtures for the subscription-dodo tests: Standard Webhooks signing,
// a recording `send` mock and a stub ctx + runtimes wired like the mounted feature.

import { createHmac } from "node:crypto";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  qn,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import type { DodoSend } from "../client.ts";
import {
  DODO_API_KEY_CONFIG,
  DODO_BILLING_LIVE_CONFIG,
  DODO_ENVIRONMENT_CONFIG,
  DODO_WEBHOOK_SECRET_CONFIG,
  type DodoEnvironment,
  SUBSCRIPTION_DODO_FEATURE,
} from "../constants.ts";
import { createDodoRuntimes } from "../runtime.ts";

export const TEST_SIGNING_KEY = "dodo-test-signing-key";
export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from(TEST_SIGNING_KEY).toString("base64")}`;
export const TEST_API_KEY = "dodo_test_api_key_value";

export function signStandardWebhook(input: {
  readonly id: string;
  readonly timestamp: string;
  readonly body: string;
  readonly secret?: string;
}): string {
  const secret = input.secret ?? TEST_WEBHOOK_SECRET;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const digest = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest("base64");
  return `v1,${digest}`;
}

export function webhookHeaders(input: {
  readonly id: string;
  readonly timestamp: string;
  readonly body: string;
  readonly secret?: string;
}): Record<string, string> {
  return {
    "webhook-id": input.id,
    "webhook-timestamp": input.timestamp,
    "webhook-signature": signStandardWebhook(input),
  };
}

export type RecordedCall = {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly body: unknown;
};

export type MockReply = { readonly status?: number; readonly body?: unknown };

/** Records every call; replies come from `respond`, keyed by the call. */
export function createSendMock(respond: (call: RecordedCall) => MockReply = () => ({ body: {} })) {
  const calls: RecordedCall[] = [];
  const send: DodoSend = async (url, init) => {
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body:
        rawBody === undefined
          ? undefined
          : parseJsonOrThrow<unknown>(rawBody, "recorded request body"),
    };
    calls.push(call);
    const reply = respond(call);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  return { send, calls };
}

const handleName = (shortKey: string): string =>
  qn(toKebab(SUBSCRIPTION_DODO_FEATURE), "config", toKebab(shortKey));

export const API_KEY_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(DODO_API_KEY_CONFIG),
  type: "text",
};
export const WEBHOOK_SECRET_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(DODO_WEBHOOK_SECRET_CONFIG),
  type: "text",
};
export const BILLING_LIVE_HANDLE: ConfigKeyHandle<"boolean"> = {
  name: handleName(DODO_BILLING_LIVE_CONFIG),
  type: "boolean",
};
export const ENVIRONMENT_HANDLE: ConfigKeyHandle<"select"> = {
  name: handleName(DODO_ENVIRONMENT_CONFIG),
  type: "select",
};

export function stubCtx(
  config: { readonly billingLive?: boolean; readonly environment?: DodoEnvironment } = {},
): HandlerContext {
  return {
    auditUserId: "tester",
    obs: { log: { warn() {} } },
    config: async (handle: ConfigKeyHandle<"text" | "boolean" | "select">) => {
      if (handle.name === BILLING_LIVE_HANDLE.name) return config.billingLive ?? true;
      if (handle.name === ENVIRONMENT_HANDLE.name) return config.environment ?? "test";
      return undefined;
    },
  } as unknown as HandlerContext; // @cast-boundary test-stub — partial ctx
}

export function makeRuntimes(
  send: DodoSend,
  fallback: { apiKey?: string; webhookSecret?: string } = {
    apiKey: TEST_API_KEY,
    webhookSecret: TEST_WEBHOOK_SECRET,
  },
) {
  return createDodoRuntimes({
    apiKeyHandle: API_KEY_HANDLE,
    webhookSecretHandle: WEBHOOK_SECRET_HANDLE,
    billingLiveHandle: BILLING_LIVE_HANDLE,
    environmentHandle: ENVIRONMENT_HANDLE,
    send,
    fallback,
  });
}

export const NOW_SECONDS = 1_770_000_000;

export function subscriptionData(overrides: Record<string, unknown> = {}) {
  return {
    subscription_id: "sub_dodo_1",
    product_id: "pdt_pro",
    status: "active",
    customer: { customer_id: "cus_dodo_1", email: "buyer@example.test" },
    metadata: { tenantId: "tenant-dodo", consentId: "consent-1" },
    next_billing_date: "2026-12-01T10:00:00Z",
    cancel_at_next_billing_date: false,
    ...overrides,
  };
}

export function envelope(type: string, data: unknown): string {
  return JSON.stringify({
    business_id: "bus_1",
    type,
    timestamp: "2026-11-01T10:00:00Z",
    data,
  });
}
