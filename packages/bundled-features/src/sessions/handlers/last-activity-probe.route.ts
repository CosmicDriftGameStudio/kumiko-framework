import { type FeatureRegistrar, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createLastActivityProbeQuery,
  LAST_ACTIVITY_PROBE_QUERY,
} from "./last-activity-probe.query.ts";

// The route is reachable anonymously, so a short secret would be guessable within the rate limit.
const MIN_PROBE_SECRET_LENGTH = 32;

export const LAST_ACTIVITY_PROBE_SECRET_ENV = "SESSIONS_LAST_ACTIVITY_PROBE_SECRET";

// Env is the fallback for apps that mount sessions without options; the value is never echoed.
export function readProbeSecretFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const secret = env[LAST_ACTIVITY_PROBE_SECRET_ENV];
  if (secret === undefined) return undefined;
  if (secret.length < MIN_PROBE_SECRET_LENGTH) {
    throw new Error(
      `sessions: ${LAST_ACTIVITY_PROBE_SECRET_ENV} must be at least ${MIN_PROBE_SECRET_LENGTH} characters`,
    );
  }
  return secret;
}

export function registerLastActivityProbe(r: FeatureRegistrar, secret: string): void {
  if (secret.length < MIN_PROBE_SECRET_LENGTH) {
    throw new Error(
      `sessions: lastActivityProbeSecret must be at least ${MIN_PROBE_SECRET_LENGTH} characters`,
    );
  }
  r.queryHandler(createLastActivityProbeQuery(secret));
  r.httpRoute({
    method: "GET",
    // A string literal so feature-ast can read the route; r.httpRoute paths stay outside /api/*.
    path: "/sessions/last-activity",
    anonymous: true,
    rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
    handler: async (c, { systemQuery }) => {
      const bearerToken = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
      if (bearerToken === undefined) return c.body(null, 401);
      try {
        const answer = await systemQuery(
          LAST_ACTIVITY_PROBE_QUERY,
          { bearerToken },
          SYSTEM_TENANT_ID,
        );
        return c.json(answer);
      } catch {
        // Wrong secret and any handler failure look the same to the caller.
        return c.body(null, 401);
      }
    },
  });
}
