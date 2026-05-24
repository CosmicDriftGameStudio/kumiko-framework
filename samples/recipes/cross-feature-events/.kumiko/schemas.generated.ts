// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

// Schema extracts purely for type inference: this file is referenced
// from types.generated.d.ts via `import type`. ts-strip elides it at
// build time, so there is NO runtime duplication of the inline schemas
// in feature files. When an event schema changes: re-run `yarn kumiko
// codegen` — otherwise the z.infer type drifts from the runtime schema.

import { z } from "zod";

// pubsub-orders:event:order-placed — from /Users/marc/code/cosmicdriftgamestudio/kumiko-framework/samples/recipes/cross-feature-events/src/feature.ts:71
export const _kg_pubsubOrders__orderPlaced = z.object({ id: z.string(), customer: z.string(), product: z.string() });
