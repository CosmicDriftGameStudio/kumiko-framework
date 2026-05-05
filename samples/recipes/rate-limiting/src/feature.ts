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
    r.queryHandler(
      "expensive-search",
      z.object({ q: z.string().min(1) }),
      async ({ payload }) => ({ q: payload.q, hits: 0 }),
      {
        access: { roles: ["Admin", "User"] },
        rateLimit: { per: "user", limit: 3, windowSeconds: 60 },
      },
    );
  });
}
