// Shared fixtures for the subscription-paddle tests: Paddle-Signature signing,
// a recording `send` mock and a stub ctx + runtimes wired like the mounted feature.

import { createHmac } from "node:crypto";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  qn,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import type { PaddleSend } from "../client.ts";
import {
  PADDLE_API_KEY_CONFIG,
  PADDLE_BILLING_LIVE_CONFIG,
  PADDLE_CLIENT_TOKEN_CONFIG,
  PADDLE_ENVIRONMENT_CONFIG,
  PADDLE_TENANT_BINDING_KEY_CONFIG,
  PADDLE_WEBHOOK_SECRET_CONFIG,
  type PaddleEnvironment,
  SUBSCRIPTION_PADDLE_FEATURE,
} from "../constants.ts";
import { createPaddleRuntimes, type PaddleFallbacks } from "../runtime.ts";
import { signTenantBinding } from "../tenant-binding.ts";

export const TEST_WEBHOOK_SECRET = "pdl_ntfset_test_secret";
export const TEST_API_KEY = "pdl_test_api_key_value";
export const TEST_BINDING_KEY = "test-tenant-binding-key";
export const TEST_CLIENT_TOKEN = "test_client_token_value";
export const NOW_SECONDS = 1_770_000_000;

export function signPaddleBody(input: {
  readonly timestamp: string;
  readonly body: string;
  readonly secret?: string;
}): string {
  return createHmac("sha256", input.secret ?? TEST_WEBHOOK_SECRET)
    .update(`${input.timestamp}:${input.body}`)
    .digest("hex");
}

export function paddleSignatureHeader(input: {
  readonly timestamp: string;
  readonly body: string;
  readonly secret?: string;
}): string {
  return `ts=${input.timestamp};h1=${signPaddleBody(input)}`;
}

export function webhookHeaders(input: {
  readonly timestamp: string;
  readonly body: string;
  readonly secret?: string;
}): Record<string, string> {
  return { "paddle-signature": paddleSignatureHeader(input) };
}

export type RecordedCall = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly authorization: string | null;
  readonly body: unknown;
};

export type MockReply = { readonly status?: number; readonly body?: unknown };

/** Records every call; replies come from `respond`, keyed by the call. */
export function createSendMock(respond: (call: RecordedCall) => MockReply = () => ({ body: {} })) {
  const calls: RecordedCall[] = [];
  const send: PaddleSend = async (url, init) => {
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
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
  qn(toKebab(SUBSCRIPTION_PADDLE_FEATURE), "config", toKebab(shortKey));

export const API_KEY_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(PADDLE_API_KEY_CONFIG),
  type: "text",
};
export const WEBHOOK_SECRET_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(PADDLE_WEBHOOK_SECRET_CONFIG),
  type: "text",
};
export const TENANT_BINDING_KEY_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(PADDLE_TENANT_BINDING_KEY_CONFIG),
  type: "text",
};
export const CLIENT_TOKEN_HANDLE: ConfigKeyHandle<"text"> = {
  name: handleName(PADDLE_CLIENT_TOKEN_CONFIG),
  type: "text",
};
export const BILLING_LIVE_HANDLE: ConfigKeyHandle<"boolean"> = {
  name: handleName(PADDLE_BILLING_LIVE_CONFIG),
  type: "boolean",
};
export const ENVIRONMENT_HANDLE: ConfigKeyHandle<"select"> = {
  name: handleName(PADDLE_ENVIRONMENT_CONFIG),
  type: "select",
};

export function stubCtx(
  config: { readonly billingLive?: boolean; readonly environment?: PaddleEnvironment } = {},
): HandlerContext {
  return {
    services: { extensions: {} },
    user: { id: "tester" },
    obs: { log: { warn() {} } },
    config: async (handle: ConfigKeyHandle<"text" | "boolean" | "select">) => {
      if (handle.name === BILLING_LIVE_HANDLE.name) return config.billingLive ?? true;
      if (handle.name === ENVIRONMENT_HANDLE.name) return config.environment ?? "sandbox";
      return undefined;
    },
  } as unknown as HandlerContext; // @cast-boundary test-stub — partial ctx
}

export const DEFAULT_FALLBACK: PaddleFallbacks = {
  apiKey: TEST_API_KEY,
  webhookSecret: TEST_WEBHOOK_SECRET,
  tenantBindingKey: TEST_BINDING_KEY,
  clientToken: TEST_CLIENT_TOKEN,
};

export function makeRuntimes(send: PaddleSend, fallback: PaddleFallbacks = DEFAULT_FALLBACK) {
  return createPaddleRuntimes({
    apiKeyHandle: API_KEY_HANDLE,
    webhookSecretHandle: WEBHOOK_SECRET_HANDLE,
    tenantBindingKeyHandle: TENANT_BINDING_KEY_HANDLE,
    clientTokenHandle: CLIENT_TOKEN_HANDLE,
    billingLiveHandle: BILLING_LIVE_HANDLE,
    environmentHandle: ENVIRONMENT_HANDLE,
    send,
    fallback,
  });
}

export function boundCustomData(tenantId: string, extra: Record<string, unknown> = {}) {
  return { tenantId, tenantBinding: signTenantBinding(TEST_BINDING_KEY, tenantId), ...extra };
}

export function subscriptionData(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_paddle_1",
    status: "active",
    customer_id: "ctm_paddle_1",
    items: [{ price: { id: "pri_pro" } }],
    custom_data: boundCustomData("tenant-paddle", { consentId: "consent-1" }),
    current_billing_period: { ends_at: "2026-12-01T10:00:00Z" },
    next_billed_at: "2026-12-01T10:00:00Z",
    scheduled_change: null,
    canceled_at: null,
    ...overrides,
  };
}

export function envelope(type: string, data: unknown, eventId = "evt_1"): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: type,
    occurred_at: "2026-11-01T10:00:00Z",
    notification_id: "ntf_1",
    data,
  });
}
