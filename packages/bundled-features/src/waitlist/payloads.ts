import { canonicalizeLocaleTag, isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";
import * as z from "zod";
import { WAITLIST_FIELD_LIMITS } from "./constants.js";

// Submitted text lands in a mail subject; CR/LF there would allow header injection.
const NO_CONTROL_CHARS = /^\P{Cc}*$/u;
const NO_CONTROL_CHARS_EXCEPT_WHITESPACE = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;
const noControlChars = (value: string) => NO_CONTROL_CHARS.test(value);

export const WaitlistSubmitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(WAITLIST_FIELD_LIMITS.name)
      .refine(noControlChars, "control characters not allowed"),
    email: z.email().max(WAITLIST_FIELD_LIMITS.email),
    company: z
      .string()
      .trim()
      .min(1)
      .max(WAITLIST_FIELD_LIMITS.company)
      .refine(noControlChars, "control characters not allowed")
      .optional(),
    portfolio: z
      .string()
      .trim()
      .min(1)
      .max(WAITLIST_FIELD_LIMITS.portfolio)
      .refine(noControlChars, "control characters not allowed")
      .optional(),
    message: z
      .string()
      .trim()
      .min(1)
      .max(WAITLIST_FIELD_LIMITS.message)
      .refine(
        (value) => NO_CONTROL_CHARS_EXCEPT_WHITESPACE.test(value),
        "control characters not allowed",
      )
      .optional(),
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
