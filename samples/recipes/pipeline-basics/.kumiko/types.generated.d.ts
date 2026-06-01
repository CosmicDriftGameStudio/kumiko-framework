// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `bun kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

import type { z } from "zod";
import type { _kg_inventory__productArchived, _kg_inventory__productStockAdjusted } from "./schemas.generated";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoEventTypeMap {
    "inventory:event:product-archived": z.infer<typeof _kg_inventory__productArchived>;
    "inventory:event:product-stock-adjusted": z.infer<typeof _kg_inventory__productStockAdjusted>;
  }
}

export {};
