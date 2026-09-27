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

import type { lookup } from "node:dns/promises";
import {
  BlockedHostError,
  buildPinnedRequest,
  HostResolutionError,
  resolvePublicHostname,
} from "@cosmicdrift/kumiko-framework/http";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
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
    return { ok: false, error: `invalid url "${spec.url}"` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `unsupported url scheme "${url.protocol}"` };
  }

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

  const allowedPrivateHosts = readAllowedPrivateWebhookHostsFromEnv();
  const isAllowedPrivateHost = allowedPrivateHosts.some(
    (candidate) => candidate.toLowerCase() === url.hostname.toLowerCase(),
  );

  let fetchUrl: string | URL = spec.url;
  let requestInit: RequestInit = { headers };
  if (!isAllowedPrivateHost) {
    try {
      const resolved = await resolvePublicHostname(url.hostname, webhookHostLookup);
      const pinned = buildPinnedRequest(url, resolved, { headers });
      fetchUrl = pinned.url;
      requestInit = pinned.init;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof BlockedHostError || err instanceof HostResolutionError) {
        log.warn("webhook host unreachable", { host: url.hostname, reason });
        return { ok: false, error: "webhook host is not reachable or not allowed" };
      }
      throw err;
    }
  }

  try {
    const res = await fetchImpl(fetchUrl, {
      ...requestInit,
      method: spec.method,
      redirect: "manual",
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
