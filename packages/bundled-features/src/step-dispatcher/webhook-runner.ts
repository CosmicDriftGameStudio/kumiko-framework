// Webhook execution logic — separated from feature.ts so tests can stub
// the fetch without touching the MSP wiring.

import { z } from "zod";

export const webhookSpecSchema = z.object({
  url: z.string(),
  method: z.enum(["POST", "PUT", "PATCH"]),
  headers: z.record(z.string(), z.string()),
  body: z.unknown().optional(),
  auth: z
    .union([
      z.object({ kind: z.literal("bearer"), secretRef: z.string() }),
      z.object({ kind: z.literal("header"), name: z.string(), secretRef: z.string() }),
    ])
    .optional(),
});

export type WebhookSpec = z.infer<typeof webhookSpecSchema>;

export type WebhookDispatchResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly error: string };

// Resolves a secretRef via the test-injectable secret-store. Default
// implementation reads from process.env at the prefix WEBHOOK_SECRET_.
// Tests pass a custom resolver via setWebhookSecretResolver.
let secretResolver: (ref: string) => string | undefined = (ref) =>
  process.env[`WEBHOOK_SECRET_${ref}`];

export function setWebhookSecretResolver(fn: (ref: string) => string | undefined): void {
  secretResolver = fn;
}

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

export function setWebhookFetch(fn: typeof fetch): void {
  fetchImpl = fn;
}

export async function performWebhookDispatch(spec: WebhookSpec): Promise<WebhookDispatchResult> {
  const headers: Record<string, string> = { "content-type": "application/json", ...spec.headers };
  if (spec.auth) {
    const secret = secretResolver(spec.auth.secretRef);
    if (!secret) {
      return { ok: false, error: `secret "${spec.auth.secretRef}" not configured` };
    }
    if (spec.auth.kind === "bearer") {
      headers["authorization"] = `Bearer ${secret}`;
    } else {
      headers[spec.auth.name] = secret;
    }
  }
  try {
    const res = await fetchImpl(spec.url, {
      method: spec.method,
      headers,
      body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
