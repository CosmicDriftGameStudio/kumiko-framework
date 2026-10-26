import * as z from "zod";

/** Optional on every handler that can set it: undefined keeps the stored id, null or "" clears it. */
export const trustedAuthservIdInputSchema = z.string().trim().max(255).nullable().optional();
