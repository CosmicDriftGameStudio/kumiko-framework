// Zod-Schema fuer RetentionOverride mit .strict() — Sprint 2.D2.5 (M2+M3).
//
// Symmetrisch zu compliance-profiles override-schema.ts (S1.9 Z3).
// Sub-Sprint-Pattern (advisor-pinned): bei jedem User-konfigurierbarem
// JSON-Override → strict-Zod + enum-validated.
//
// Schuetzt vor:
//   - Top-Level-Tippfehler ("keepfor" statt "keepFor") — strict()-Reject
//   - Strategy-Enum-Drift ("delete" statt "hardDelete") — z.enum-Reject
//   - keepFor-Format-Drift ("30days" statt "30d") — regex-Reject
//
// Tenant-Override darf alle drei Properties weglassen (Resolver
// fallback auf Preset/Entity-Default), aber WAS gesetzt ist muss
// gueltig sein.

import { z } from "zod";

const KEEP_FOR_PATTERN = /^\d+[hdwmy]$/;

const retentionStrategySchema = z.enum(["hardDelete", "softDelete", "anonymize", "blockDelete"]);

/**
 * RetentionOverride-Zod-Schema mit .strict() — fuer (a) set-override-
 * Handler-Validation (S2.D3) und (b) DB-Loader im Cleanup-Job (S2.D2b)
 * der invalides JSON aus der config-Spalte loggt + skipt statt mit
 * undefined behavior weiterzumachen.
 */
export const retentionOverrideSchema = z
  .object({
    keepFor: z
      .string()
      .regex(KEEP_FOR_PATTERN, "keepFor must match /^\\d+[hdwmy]$/ (e.g. '30d', '10y', '6m')")
      .optional(),
    strategy: retentionStrategySchema.optional(),
    reference: z.string().min(1).optional(),
  })
  .strict();
