import { canonicalizeLocaleTag, isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";
import * as z from "zod";
import {
  CONTACT_ADMIN_KINDS,
  CONTACT_FIELD_LIMITS,
  CONTACT_MAX_FILES,
  CONTACT_WEBSITE_KINDS,
} from "./web/constants.ts";

// Submitted text lands in mail subjects; CR/LF there would allow header injection.
const NO_CONTROL_CHARS = /^\P{Cc}*$/u;
const NO_CONTROL_CHARS_EXCEPT_WHITESPACE = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;
const noControlChars = (value: string) => NO_CONTROL_CHARS.test(value);
const CONTROL_CHARS_MESSAGE = "control characters not allowed";

const singleLine = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControlChars, CONTROL_CHARS_MESSAGE);

const multiLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => NO_CONTROL_CHARS_EXCEPT_WHITESPACE.test(value), CONTROL_CHARS_MESSAGE);

// An empty phone field of a form counts as absent.
const phone = z
  .string()
  .trim()
  .max(CONTACT_FIELD_LIMITS.phone)
  .refine(noControlChars, CONTROL_CHARS_MESSAGE)
  .optional();

const pagePath = z
  .string()
  .trim()
  .max(CONTACT_FIELD_LIMITS.page)
  .refine(noControlChars, CONTROL_CHARS_MESSAGE)
  // Query strings and fragments carry tokens and ids (reset links, session hints) that must not
  // end up in an inbox that is kept for a year.
  .transform((value) => value.split(/[?#]/, 1)[0] ?? "")
  .optional();

const locale = z
  .string()
  .max(CONTACT_FIELD_LIMITS.locale)
  .refine(isValidLocaleTag, "invalid locale tag")
  .transform(canonicalizeLocaleTag);

export const ContactSubmitSchema = z
  .object({
    kind: z.enum(CONTACT_WEBSITE_KINDS),
    name: singleLine(CONTACT_FIELD_LIMITS.name),
    email: z.email().max(CONTACT_FIELD_LIMITS.email),
    phone,
    message: multiLine(CONTACT_FIELD_LIMITS.message),
    locale,
    // Honeypot: bots fill it, humans leave it empty.
    website: z.string().max(CONTACT_FIELD_LIMITS.honeypot).optional(),
    challenge: z.string().max(CONTACT_FIELD_LIMITS.challenge),
    nonce: z.string().max(CONTACT_FIELD_LIMITS.nonce),
    page: pagePath,
  })
  .strict();
export type ContactSubmitInput = z.infer<typeof ContactSubmitSchema>;

export const ContactReportSchema = z
  .object({
    kind: z.enum(CONTACT_ADMIN_KINDS),
    subject: singleLine(CONTACT_FIELD_LIMITS.subject),
    message: multiLine(CONTACT_FIELD_LIMITS.message),
    phone,
    fileIds: z.array(z.uuid()).max(CONTACT_MAX_FILES).optional(),
  })
  .strict();
export type ContactReportInput = z.infer<typeof ContactReportSchema>;

export const ContactIdSchema = z.object({ id: z.uuid() }).strict();

export const ContactReplySchema = z
  .object({
    requestId: z.uuid(),
    message: multiLine(CONTACT_FIELD_LIMITS.message),
    fileIds: z.array(z.uuid()).max(CONTACT_MAX_FILES).optional(),
    markDone: z.boolean().default(false),
  })
  .strict();

export const ContactMarkDoneSchema = ContactIdSchema;

export const ContactForwardRequestSchema = z.object({ requestId: z.uuid() }).strict();

export const ContactSendReplyMailSchema = z.object({ replyId: z.uuid() }).strict();

export const ContactNotifyReporterInAppSchema = z
  .object({
    replyId: z.uuid(),
    requestId: z.uuid(),
    userId: z.uuid(),
    authorName: z.string().max(CONTACT_FIELD_LIMITS.name),
    locale: z.string().max(CONTACT_FIELD_LIMITS.locale).optional(),
  })
  .strict();

export const ContactEmptySchema = z.object({}).strict();
