import { BlockedHostError, type EgressPolicy, egress } from "@cosmicdrift/kumiko-framework/http";
import * as z from "zod";

// Closed vocabulary: these codes (and nothing else) land in delivery_attempts.error.
// Never err.message and never a provider response body — a fetch error can carry
// the request URL, and the Telegram URL embeds the bot token.
export type ChatSendFailureCode =
  | `http_${number}`
  | "timeout"
  | "network_error"
  | "redirect_blocked"
  | "host_not_allowed"
  | "missing_credentials"
  | "invalid_address";

export type ChatSendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ChatSendFailureCode };

export const DEFAULT_CHAT_TIMEOUT_MS = 10_000;

// Tenant-chosen connection name (the route address for webhook channels). Also
// the suffix the secrets write gate accepts under the channel's namespace, so
// the two cannot drift. Validated before it is used to build a secret key.
export const chatConnectionNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export type ChatWebhookRequest = {
  readonly url: string;
  // Exact hostnames, or suffixes with a leading dot (".webhook.office.com").
  readonly allowedHosts: readonly string[];
  readonly requireHttps: boolean;
  readonly requiredPathPrefix?: string;
  readonly timeoutMs: number;
  readonly body: unknown;
  // Test seam; production always uses the policy-bound egress().
  readonly send?: (url: string, init: RequestInit) => Promise<Response>;
};

// https targets are provider endpoints on public hosts: egress "external" adds
// the private/reserved-range denial and DNS pinning on top of our allowlist. The
// cleartext opt-out (requireHttps: false) exists for operator-trusted local
// endpoints, which "external" would refuse; the allowlist already pins the host.
function policyFor(request: ChatWebhookRequest, target: URL): EgressPolicy {
  return request.requireHttps
    ? { kind: "external" }
    : { kind: "internal", allowHosts: [target.hostname] };
}

function hostMatches(hostname: string, allowedHost: string): boolean {
  const allowed = allowedHost.toLowerCase();
  if (allowed.startsWith(".")) {
    return hostname.length > allowed.length && hostname.endsWith(allowed);
  }
  return hostname === allowed;
}

// Allowlist runs on the parsed URL, never on the raw string: userinfo
// (`https://hooks.slack.com@evil.com`) and look-alike suffixes must not pass.
function checkTarget(request: ChatWebhookRequest): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return undefined;
  }
  const protocolAllowed =
    parsed.protocol === "https:" || (!request.requireHttps && parsed.protocol === "http:");
  if (!protocolAllowed) return undefined;
  // egress() has no port rule; a provider webhook over https never needs a custom port.
  if (request.requireHttps && parsed.port !== "") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  const hostname = parsed.hostname.toLowerCase();
  if (!request.allowedHosts.some((allowed) => hostMatches(hostname, allowed))) return undefined;
  if (
    request.requiredPathPrefix !== undefined &&
    !parsed.pathname.startsWith(request.requiredPathPrefix)
  ) {
    return undefined;
  }
  return parsed;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// egress(internal) follows same-host redirects itself and throws on cross-host
// ones; both are the "redirect" outcome here. Matched on the stable message
// prefix only — the message is discarded, it can carry the Location header.
function isEgressRedirectRefusal(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("egress(internal): redirect");
}

function classifyFailure(err: unknown): ChatSendFailureCode {
  if (err instanceof BlockedHostError) return "host_not_allowed";
  if (isEgressRedirectRefusal(err)) return "redirect_blocked";
  return isTimeout(err) ? "timeout" : "network_error";
}

// Never throws and never surfaces the URL: egress/Bun errors can carry it, so
// every failure is reduced to a code here.
export async function postChatWebhook(request: ChatWebhookRequest): Promise<ChatSendResult> {
  const target = checkTarget(request);
  if (!target) return { ok: false, code: "host_not_allowed" };

  let response: Response;
  try {
    const send = request.send ?? egress(policyFor(request, target));
    response = await send(target.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (err) {
    return { ok: false, code: classifyFailure(err) };
  }

  // Free the connection; the body is never read or stored.
  await response.body?.cancel().catch(() => undefined);

  const { status } = response;
  if (status >= 300 && status < 400) return { ok: false, code: "redirect_blocked" };
  if (status >= 200 && status < 300) return { ok: true };
  return { ok: false, code: `http_${status}` };
}

export function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : chars.slice(0, maxChars).join("");
}
