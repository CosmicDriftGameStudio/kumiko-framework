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

// billing:event:invoice-cancelled — from src/feature.ts:50
export const _kg_billing__invoiceCancelled = z.object({});

// billing:event:invoice-marked-paid — from src/feature.ts:49
export const _kg_billing__invoiceMarkedPaid = z.object({});

// billing:event:invoice-reopened — from src/feature.ts:51
export const _kg_billing__invoiceReopened = z.object({});

// billing:event:invoice-sent — from src/feature.ts:48
export const _kg_billing__invoiceSent = z.object({});

// billing:event:invoice-status-forced — from src/feature.ts:52
export const _kg_billing__invoiceStatusForced = z.object({
      newStatus: z.enum(["draft", "sent", "paid", "cancelled"]),
      fromStatus: z.enum(["draft", "sent", "paid", "cancelled"]),
    });
