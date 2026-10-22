// Rate-Limiting Showcase — minimal feature
//
// Declares one query handler with an L3 rateLimit option so the
// dispatcher gates calls before the handler body runs. The integration
// test pairs this with L1+L2 middleware wired via buildServer's
// `rateLimit` option to prove all three layers stack.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export function createRateLimitShowcaseFeature(): FeatureDefinition {
  return defineFeature("rl-showcase", (r) => {
    // Per-user budget. Real apps tune `limit` to actual handler cost — a
    // search call against a sharded index might warrant 5/min, a full
    // export 1/min. The bucket is `user:<userId>` (see rate-limit/bucket.ts).
    r.queryHandler({
      name: "expensive-search",
      schema: z.object({ q: z.string().min(1) }),
      handler: async ({ payload }) => ({ q: payload.q, hits: 0 }),
      access: { roles: ["Admin", "User"] },
      rateLimit: { per: "user", limit: 3, windowSeconds: 60 },
    });

    // Combined budget: each caller gets 2 submits per hour and the tenant 3 per hour in
    // total. Both buckets are checked together; a request one bucket rejects charges neither.
    r.writeHandler({
      name: "submit-report",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { roles: ["Admin", "User"] },
      rateLimit: [
        { per: "user", limit: 2, windowSeconds: 3600 },
        { per: "tenant+handler", limit: 3, windowSeconds: 3600 },
      ],
    });

    // Bulk upload: a request books one token per item instead of one per request. The cost
    // comes from the validated payload, so a schema-invalid request costs nothing; a request
    // that would exceed the remaining budget is rejected and consumes nothing.
    r.writeHandler({
      name: "bulk-upload",
      schema: z.object({ files: z.array(z.string()).min(1).max(20) }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { roles: ["Admin", "User"] },
      rateLimit: { per: "tenant+handler", limit: 20, windowSeconds: 600 },
      rateLimitCost: (payload) => payload.files.length,
    });
  });
}
