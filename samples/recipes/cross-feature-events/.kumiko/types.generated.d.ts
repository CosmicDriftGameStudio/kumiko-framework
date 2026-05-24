// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

import type { z } from "zod";
import type { _kg_pubsubOrders__orderPlaced } from "./schemas.generated";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoEventTypeMap {
    "pubsub-orders:event:order-placed": z.infer<typeof _kg_pubsubOrders__orderPlaced>;
  }
}
