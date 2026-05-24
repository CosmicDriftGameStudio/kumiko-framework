// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

import type { z } from "zod";
import type { _kg_showcase__invoiceAcknowledged, _kg_showcase__invoiceApproved, _kg_showcase__invoicePaid } from "./schemas.generated";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoEventTypeMap {
    "showcase:event:invoice-acknowledged": z.infer<typeof _kg_showcase__invoiceAcknowledged>;
    "showcase:event:invoice-approved": z.infer<typeof _kg_showcase__invoiceApproved>;
    "showcase:event:invoice-paid": z.infer<typeof _kg_showcase__invoicePaid>;
  }
}

export {};
