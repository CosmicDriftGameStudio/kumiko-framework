// Strict Zod schema for RetentionOverride.
//
// Symmetric with compliance-profiles override-schema.ts.
// Every user-configurable JSON override uses strict Zod validation
// with enum validation.
//
// Protects against:
//   - Top-level typos ("keepfor" instead of "keepFor") — strict() rejects them
//   - Strategy enum drift ("delete" instead of "hardDelete") — z.enum rejects it
//   - keepFor format drift ("30days" instead of "30d") — regex rejects it
//
// A tenant override may omit all three properties (the resolver falls back
// to the preset/entity default), but every property that is set must be valid.

import * as z from "zod";

const KEEP_FOR_PATTERN = /^\d+[hdwmy]$/;

const retentionStrategySchema = z.enum(["hardDelete", "softDelete", "anonymize", "blockDelete"]);

/**
 * Strict Zod schema for RetentionOverride, used by the set-override handler
 * and the cleanup job's DB loader. The loader logs invalid JSON from the
 * config column and skips it instead of continuing with undefined behavior.
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
