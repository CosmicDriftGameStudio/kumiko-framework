// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

import type { z } from "zod";
import type { _kg_billing__invoiceCancelled, _kg_billing__invoiceMarkedPaid, _kg_billing__invoiceReopened, _kg_billing__invoiceSent, _kg_billing__invoiceStatusForced } from "./schemas.generated";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoEventTypeMap {
    "billing:event:invoice-cancelled": z.infer<typeof _kg_billing__invoiceCancelled>;
    "billing:event:invoice-marked-paid": z.infer<typeof _kg_billing__invoiceMarkedPaid>;
    "billing:event:invoice-reopened": z.infer<typeof _kg_billing__invoiceReopened>;
    "billing:event:invoice-sent": z.infer<typeof _kg_billing__invoiceSent>;
    "billing:event:invoice-status-forced": z.infer<typeof _kg_billing__invoiceStatusForced>;
  }
}

export {};
