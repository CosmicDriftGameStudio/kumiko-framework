import { timingSafeEqual } from "node:crypto";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { userSessionTable } from "../schema/user-session.ts";

export const LAST_ACTIVITY_PROBE_QUERY = "sessions:query:last-activity-probe";

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

const PROBE_ESCAPE_HATCH_REASON =
  "answers one sibling app with the newest session activity across every tenant of this app, guarded by a shared secret";

function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

// The route's systemQuery runs as an anonymous user, so the query must accept that role. The
// secret is checked here as well as in the route, so no other dispatch path that reaches the
// query can expose the app-wide activity time without it.
export function createLastActivityProbeQuery(secret: string) {
  return defineQueryHandler({
    name: "last-activity-probe",
    schema: z.object({ bearerToken: z.string().min(1).max(512) }),
    access: { roles: ["anonymous"] },
    agent: { expose: false },
    rateLimit: { per: "ip", limit: 30, windowSeconds: 60 },
    escapeHatch: { grants: ["crossTenantReads"], reason: PROBE_ESCAPE_HATCH_REASON },
    description:
      "Returns the newest session activity time across every tenant of this app to a sibling app that presents the shared probe secret.",
    handler: async (query, ctx) => {
      if (!secretsMatch(query.payload.bearerToken, secret)) {
        throw new AccessDeniedError();
      }
      if (!ctx.crossTenantReads) {
        throw new InternalError({
          message: "sessions last-activity probe: crossTenantReads missing",
        });
      }
      const [newest] = await ctx.crossTenantReads.selectMany<{ lastSeenAt: Temporal.Instant }>(
        userSessionTable,
        { lastSeenAt: { gte: EPOCH } },
        { limit: 1, orderBy: { col: "lastSeenAt", direction: "desc" } },
      );
      return { lastActivityAt: newest ? newest.lastSeenAt.toString() : null };
    },
  });
}
