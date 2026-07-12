// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `bun kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

// Schema extracts purely for type inference: this file is referenced
// from types.generated.d.ts via `import type`. ts-strip elides it at
// build time, so there is NO runtime duplication of the inline schemas
// in feature files. When an event schema changes: re-run `bun kumiko
// codegen` — otherwise the z.infer type drifts from the runtime schema.

import { z } from "zod";

// showcase:event:invoice-acknowledged — from src/feature.ts:151
export const _kg_showcase__invoiceAcknowledged = z.object({ approverId: z.string(), approverDisplayName: z.string() });

// showcase:event:invoice-approved — from src/feature.ts:134
export const _kg_showcase__invoiceApproved = z.object({ amountCents: z.number().int(), approvedBy: z.string() });

// showcase:event:invoice-paid — from src/feature.ts:144
export const _kg_showcase__invoicePaid = z.object({ amountCents: z.number().int() });
