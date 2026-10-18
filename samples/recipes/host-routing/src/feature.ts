// Host routing: one options object drives both halves. The feature makes the
// Host header the only source of the anonymous tenant; the dispatch picks the
// HTML file per host for runProdApp's `hostDispatch` (and, through
// toDevHostDispatch, for the dev server).

import {
  createHostDispatch,
  createHostRoutingFeature,
  type HostRoutingOptions,
} from "@cosmicdrift/kumiko-bundled-features/host-routing";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const routingOptions: HostRoutingOptions = {
  tenantBy: "host",
  baseDomain: "shop.test",
  apex: { file: "index.html", localeFiles: { en: "en/index.html" } },
  tenant: { file: "shop.html", csp: "default-src 'self'; frame-ancestors 'none'" },
  unknownTenant: { file: "unknown-shop.html" },
  locales: { default: "de", prefixed: ["en"] },
};

export const hostRoutingFeature = createHostRoutingFeature(routingOptions);
export const hostDispatch = createHostDispatch(routingOptions);

// A public query that reports which tenant the request landed on.
export const storefrontFeature = defineFeature("storefront", (r) => {
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async (query) => ({ tenantId: query.user.tenantId }),
  });
});
