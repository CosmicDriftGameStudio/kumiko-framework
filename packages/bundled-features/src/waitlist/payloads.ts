import { canonicalizeLocaleTag, isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";
import * as z from "zod";
import { WAITLIST_FIELD_LIMITS } from "./constants.js";

export const WaitlistSubmitSchema = z
  .object({
    name: z.string().trim().min(1).max(WAITLIST_FIELD_LIMITS.name),
    email: z.email().max(WAITLIST_FIELD_LIMITS.email),
    company: z.string().trim().min(1).max(WAITLIST_FIELD_LIMITS.company).optional(),
    portfolio: z.string().trim().min(1).max(WAITLIST_FIELD_LIMITS.portfolio).optional(),
    message: z.string().trim().min(1).max(WAITLIST_FIELD_LIMITS.message).optional(),
    locale: z
      .string()
      .max(WAITLIST_FIELD_LIMITS.locale)
      .refine(isValidLocaleTag, "invalid locale tag")
      .transform(canonicalizeLocaleTag),
    // Honeypot: bots fill it, humans leave it empty.
    website: z.string().max(WAITLIST_FIELD_LIMITS.honeypot).optional(),
  })
  .strict();

export type WaitlistSubmitInput = z.infer<typeof WaitlistSubmitSchema>;

export const WaitlistIdSchema = z.object({ id: z.uuid() }).strict();
