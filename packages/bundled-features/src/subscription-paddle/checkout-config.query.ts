import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { PaddleRuntimes } from "./runtime.ts";

// Anonymous on purpose: the checkout page is public. The answer is the public
// Paddle.js client token and the environment, nothing else.
export function makeCheckoutConfigQuery(readCheckoutConfig: PaddleRuntimes["readCheckoutConfig"]) {
  return defineQueryHandler({
    name: "checkout-config",
    schema: z.object({}),
    access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    description:
      "Answers the public Paddle.js client token and the Paddle environment for the checkout page; the client token is public by design and no other config leaves this handler.",
    handler: async (_query, ctx) => readCheckoutConfig(ctx),
  });
}
