import * as z from "zod";
import type { TemplateKind } from "./constants.js";

// One or more kebab segments joined by ":" — notification templates are seeded
// under their qualified name `feature:notify:name`.
export const templateSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)*$/,
    "slug must be kebab-case segments joined by ':'",
  );

export const MAIL_CATEGORIES = ["transactional", "marketing"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

// Header values: a CR/LF would let an author inject extra mail headers.
const singleLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), "must not contain line breaks");

const mailMetaSchema = z
  .object({
    subject: singleLine(200).min(1),
    previewText: singleLine(200).optional(),
    layoutSlug: templateSlugSchema.optional(),
    category: z.enum(MAIL_CATEGORIES).optional(),
    sender: z
      .string()
      .max(60)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "sender must be a kebab-case key")
      .optional(),
  })
  .strict();

const layoutMetaSchema = z.object({}).strict();

export type MailTemplateMeta = z.infer<typeof mailMetaSchema>;
export type LayoutTemplateMeta = z.infer<typeof layoutMetaSchema>;
export type TemplateMeta = MailTemplateMeta | LayoutTemplateMeta;

export function isMailTemplateMeta(meta: TemplateMeta | null): meta is MailTemplateMeta {
  return meta !== null && "subject" in meta;
}

export type TemplateMetaIssue = { readonly path: string; readonly message: string };

export type TemplateMetaResult =
  | { readonly ok: true; readonly meta: TemplateMeta | null }
  | { readonly ok: false; readonly issues: readonly TemplateMetaIssue[] };

function schemaForKind(kind: TemplateKind) {
  switch (kind) {
    case "mail":
      return mailMetaSchema;
    case "mail-layout":
    case "pdf-layout":
      return layoutMetaSchema;
    default:
      return null;
  }
}

// Kinds without a meta schema must not carry meta at all; mail needs it,
// layouts may omit it.
export function parseTemplateMeta(kind: TemplateKind, raw: unknown): TemplateMetaResult {
  const schema = schemaForKind(kind);
  if (schema === null) {
    return raw === undefined || raw === null
      ? { ok: true, meta: null }
      : { ok: false, issues: [{ path: "meta", message: `kind ${kind} does not take meta` }] };
  }
  if ((raw === undefined || raw === null) && kind !== "mail") return { ok: true, meta: null };
  const parsed = schema.safeParse(raw ?? undefined);
  if (parsed.success) return { ok: true, meta: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: ["meta", ...issue.path.map(String)].join("."),
      message: issue.message,
    })),
  };
}
