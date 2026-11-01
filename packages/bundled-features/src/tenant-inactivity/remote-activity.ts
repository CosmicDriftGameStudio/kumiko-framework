import { egress } from "@cosmicdrift/kumiko-framework/http";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";

const probeResponseSchema = z.object({ lastActivityAt: z.string().nullable() });

// A sleeping app (scale-to-zero) needs 23-24 s to wake and up to 45 s on its first start.
export const REMOTE_ACTIVITY_TIMEOUT_MS = 60_000;

type SendRequest = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Asks a sibling app for its newest session activity (the sessions `lastActivityProbeSecret`
 * route). Use it inside a `TenantActivitySource` so a user active in the other app keeps the
 * account alive. Fails closed: any error or timeout throws, and the job then sends no mail and files no
 * deletion request for that run. `send` exists for tests; production uses the internal egress
 * pinned to the origin of `url`.
 */
export async function fetchRemoteAppLastActivity(args: {
  readonly url: string;
  readonly secret: string;
  readonly send?: SendRequest;
  readonly timeoutMs?: number;
}): Promise<Temporal.Instant | null> {
  // Sibling apps sit in the same cluster on private addresses, which the external policy blocks.
  const send = args.send ?? egress({ kind: "internal", allowOrigins: [new URL(args.url).origin] });
  const response = await send(args.url, {
    method: "GET",
    headers: { authorization: `Bearer ${args.secret}` },
    signal: AbortSignal.timeout(args.timeoutMs ?? REMOTE_ACTIVITY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`remote activity probe answered ${response.status}`);
  }
  const body = probeResponseSchema.parse(await response.json());
  return body.lastActivityAt === null ? null : Temporal.Instant.from(body.lastActivityAt);
}
