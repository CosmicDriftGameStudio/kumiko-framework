// Webhook execution logic — separated from feature.ts so tests can stub
// the fetch without touching the MSP wiring.
//
// `spec.url` is request-controlled (a write-handler or workflow step reads
// it straight from tenant/user input — see samples/recipes/webhook-step for
// the reference usage), so it gets the same connect-time host-egress guard
// as tenant-supplied SMTP/IMAP hosts: resolve once, reject a private/
// reserved address, and pin the connect to the resolved address (Host
// header + TLS SNI keep the original hostname for cert validation).
//
// `allowedPrivateWebhookHosts` is the operator's own escape hatch for an
// internal receiver or a dev/test endpoint — an operator env var
// (KUMIKO_WEBHOOK_ALLOWED_PRIVATE_HOSTS), never a tenant-config key, so a
// tenant can never grant themselves the bypass. Own key, not the mail
// features' — step-dispatcher has no dependency relation to mail-transport-
// smtp/inbound-provider-imap and shouldn't require mounting them.
//
// `auth.secret` resolves through the secrets feature under the tenant-owned
// namespace `step-dispatcher:webhook-auth.<secret>` — the target URL is
// tenant/request-controlled, so a webhook can never read a platform-wide or
// another tenant's secret.

import type { lookup } from "node:dns/promises";
import {
  BlockedHostError,
  buildPinnedRequest,
  HostResolutionError,
  resolvePublicHostname,
} from "@cosmicdrift/kumiko-framework/http";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";

const log = createFallbackLogger("step-dispatcher");

export const WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR = "KUMIKO_WEBHOOK_ALLOWED_PRIVATE_HOSTS";

/** Parses the comma-separated operator allowlist env var. Never throws —
 *  an unset or empty value just means no bypass. */
export function readAllowedPrivateWebhookHostsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const raw = env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  if (!raw) return [];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

// Test-only DNS seam — production never calls this, resolvePublicHostname
// defaults to the real resolver. Reset it in afterEach/afterAll — this is
// module-global state.
let webhookHostLookup: typeof lookup | undefined;

export function setWebhookHostLookup(fn: typeof lookup | undefined): void {
  webhookHostLookup = fn;
}

// Tenant-owned namespace every webhook auth secret lives under in the
// secrets feature. Applied at resolution time, never at step-build time,
// so `auth.secret` stays a short, human-picked name (e.g. "smtp.password")
// while the stored key stays collision-free with every other feature's
// secrets.
export const WEBHOOK_AUTH_SECRET_KEY_PREFIX = "step-dispatcher:webhook-auth.";

export function webhookAuthSecretKey(name: string): string {
  return `${WEBHOOK_AUTH_SECRET_KEY_PREFIX}${name}`;
}

const WEBHOOK_AUTH_SECRET_NAME_MAX_LENGTH = 100 - WEBHOOK_AUTH_SECRET_KEY_PREFIX.length;

const webhookAuthSecretNameSchema = z
  .string()
  .min(1)
  .max(WEBHOOK_AUTH_SECRET_NAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const webhookSpecSchema = z.object({
  url: z.string(),
  method: z.enum(["POST", "PUT", "PATCH"]),
  headers: z.record(z.string(), z.string()),
  body: z.unknown().optional(),
  auth: z
    .union([
      z.object({ kind: z.literal("bearer"), secret: webhookAuthSecretNameSchema }),
      z.object({
        kind: z.literal("header"),
        name: z.string(),
        secret: webhookAuthSecretNameSchema,
      }),
    ])
    .optional(),
});

export type WebhookSpec = z.infer<typeof webhookSpecSchema>;

export type WebhookDispatchResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly error: string };

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

export function setWebhookFetch(fn: typeof fetch): void {
  fetchImpl = fn;
}

export type WebhookDispatchDeps = {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly secrets: SecretsContext | undefined;
};

// Never includes the secret name or value — spec.auth.secret is a
// tenant-chosen name, but the error still reaches the tenant via the
// dispatch-failed event, so it stays generic.
const WEBHOOK_AUTH_SECRET_UNAVAILABLE_ERROR = "webhook auth secret is not available";

async function buildWebhookHeaders(
  spec: WebhookSpec,
  deps: WebhookDispatchDeps,
): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; error: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...spec.headers };
  if (!spec.auth) return { ok: true, headers };
  if (!deps.secrets) return { ok: false, error: WEBHOOK_AUTH_SECRET_UNAVAILABLE_ERROR };
  const revealed = await deps.secrets.get(deps.tenantId, webhookAuthSecretKey(spec.auth.secret), {
    userId: deps.userId,
    handlerName: "step-dispatcher:webhook.send",
  });
  if (!revealed) {
    return { ok: false, error: WEBHOOK_AUTH_SECRET_UNAVAILABLE_ERROR };
  }
  const secret = revealed.reveal();
  if (spec.auth.kind === "bearer") {
    headers["authorization"] = `Bearer ${secret}`;
  } else {
    headers[spec.auth.name] = secret;
  }
  return { ok: true, headers };
}

async function resolveWebhookFetchTarget(
  rawUrl: string,
  url: URL,
  headers: Record<string, string>,
): Promise<
  { ok: true; fetchUrl: string | URL; requestInit: RequestInit } | { ok: false; error: string }
> {
  const isAllowedPrivateHost = readAllowedPrivateWebhookHostsFromEnv().some(
    (candidate) => candidate.toLowerCase() === url.hostname.toLowerCase(),
  );
  if (isAllowedPrivateHost) return { ok: true, fetchUrl: rawUrl, requestInit: { headers } };
  try {
    const resolved = await resolvePublicHostname(url.hostname, webhookHostLookup);
    const pinned = buildPinnedRequest(url, resolved, { headers });
    return { ok: true, fetchUrl: pinned.url, requestInit: pinned.init };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof BlockedHostError || err instanceof HostResolutionError) {
      log.warn("webhook host unreachable", { host: url.hostname, reason });
      return { ok: false, error: "webhook host is not reachable or not allowed" };
    }
    throw err;
  }
}

export async function performWebhookDispatch(
  spec: WebhookSpec,
  deps: WebhookDispatchDeps,
): Promise<WebhookDispatchResult> {
  // Host-egress guard at the primitive boundary: only http(s), the target
  // host must resolve to a public address (unless operator-allowlisted),
  // and redirects are never followed — a 3xx could point at an internal/
  // metadata target and the spec carries secrets (auth) that would be
  // forwarded there. A webhook destination that redirects now surfaces as
  // a delivery error instead.
  let url: URL;
  try {
    url = new URL(spec.url);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `unsupported url scheme "${url.protocol}"` };
  }

  const headers = await buildWebhookHeaders(spec, deps);
  if (!headers.ok) return headers;

  const target = await resolveWebhookFetchTarget(spec.url, url, headers.headers);
  if (!target.ok) return target;

  try {
    const res = await fetchImpl(target.fetchUrl, {
      ...target.requestInit,
      method: spec.method,
      redirect: "manual",
      body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    // err.message can echo the request URL; this text outlives the payload erase.
    return {
      ok: false,
      error: `webhook request failed (${err instanceof Error ? err.name : "unknown error"})`,
    };
  }
}
