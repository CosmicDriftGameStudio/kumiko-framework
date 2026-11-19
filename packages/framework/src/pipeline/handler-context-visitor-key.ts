import type { VisitorKey } from "@cosmicdrift/kumiko-types/identifiers";
import { UNKNOWN_CLIENT_IP } from "../api/client-ip.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";

export function resolveVisitorKey(
  scope: HandlerContextScope,
  now: Temporal.Instant,
): VisitorKey | undefined {
  const digest = scope.context._visitorKeyDigest;
  const ip = scope.reqCtx?.ip;
  // "unknown" is shared by every caller behind a misconfigured proxy; one key would merge them all.
  if (digest === undefined || ip === undefined || ip === UNKNOWN_CLIENT_IP) return undefined;
  const utcDay = now.toZonedDateTimeISO("UTC").toPlainDate().toString();
  return digest(`${utcDay}\n${ip}\n${scope.reqCtx?.userAgent ?? ""}`);
}
