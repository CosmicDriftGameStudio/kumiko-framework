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

// inventory:event:product-archived — from /Users/marc/code/cosmicdriftgamestudio/kumiko-framework-sql-queries/samples/recipes/pipeline-basics/src/feature.ts:92
export const _kg_inventory__productArchived = z.object({ reason: z.string() });

// inventory:event:product-stock-adjusted — from /Users/marc/code/cosmicdriftgamestudio/kumiko-framework-sql-queries/samples/recipes/pipeline-basics/src/feature.ts:83
export const _kg_inventory__productStockAdjusted = z.object({
      delta: z.number().int(),
      reason: z.string(),
      newStock: z.number().int(),
    });
