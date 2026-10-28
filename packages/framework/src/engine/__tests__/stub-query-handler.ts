import * as z from "zod";
import type { defineFeature } from "../define-feature.ts";

type FeatureRegistrar = Parameters<Parameters<typeof defineFeature>[1]>[0];

// Makes `<feature>:query:<name>` resolve so a fixture can reference a query without
// declaring its shape; boot validation rejects references to unregistered query handlers.
export function registerStubQueryHandler(r: FeatureRegistrar, name: string): void {
  r.queryHandler({
    name,
    schema: z.object({}),
    handler: async () => ({}),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
}
