import * as z from "zod";
import { CONTENT_FORMATS, UPSERT_KINDS } from "./constants.ts";
import { isDocumentResourceKey } from "./document-schema.ts";
import { templatePdfAttachmentLinkSchema } from "./linked-resources.ts";
import { templateSlugSchema } from "./template-meta.ts";

const MAX_RESOURCES = 20;
const MAX_LOCALES = 50;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_RESOURCE_BYTES / 3) * 4;

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const UNSAFE_FILE_NAME_CHARACTERS = /[/\\";]|\p{Cc}/u;

const bundleLocaleSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "locale must be ISO 639-1 (e.g. de, en, en-us)");

const bundleFileNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((name) => !UNSAFE_FILE_NAME_CHARACTERS.test(name) && !name.includes(".."), {
    message: 'file name must not contain / \\ " ; control characters or ".."',
  });

const bundleResourceSchema = z
  .object({
    fileName: bundleFileNameSchema,
    contentType: z.string().max(100).regex(CONTENT_TYPE, "content type must be type/subtype"),
    base64: z.string().max(MAX_BASE64_LENGTH).regex(STRICT_BASE64, "base64 is not valid"),
    // Absent means an image the body embeds; "attachment" is a file attached to the mail.
    purpose: z.enum(["attachment"]).optional(),
  })
  .strict();

const pdfAttachmentLinkBodySchema = templatePdfAttachmentLinkSchema.omit({ kind: true });

const bundleLocaleEntrySchema = z
  .object({
    body: z.string().max(200_000),
    meta: z.unknown().optional(),
    // Shown in the template overview instead of the slug; one per locale, so it is translated.
    title: z.string().min(1).max(200).optional(),
  })
  .strict();

export const templateBundleSchema = z
  .object({
    slug: templateSlugSchema,
    kind: z.enum(UPSERT_KINDS),
    contentFormat: z.enum(CONTENT_FORMATS),
    variableSchema: z.record(z.string(), z.unknown()).optional(),
    locales: z
      .record(bundleLocaleSchema, bundleLocaleEntrySchema)
      .refine((locales) => Object.keys(locales).length >= 1, {
        message: "a bundle needs at least one locale",
      })
      .refine((locales) => Object.keys(locales).length <= MAX_LOCALES, {
        message: `a bundle holds at most ${MAX_LOCALES} locales`,
      }),
    resources: z
      .record(
        z.string().refine(isDocumentResourceKey, { message: "not a valid resource key" }),
        bundleResourceSchema,
      )
      .refine((resources) => Object.keys(resources).length <= MAX_RESOURCES, {
        message: `a bundle holds at most ${MAX_RESOURCES} resources`,
      })
      .default({}),
    // PDFs rendered from document templates at send time; nothing to store, so no bytes.
    pdfAttachments: z
      .record(
        z.string().refine(isDocumentResourceKey, { message: "not a valid resource key" }),
        pdfAttachmentLinkBodySchema,
      )
      .default({}),
  })
  .strict()
  .refine(
    (bundle) => Object.keys(bundle.pdfAttachments).every((key) => !(key in bundle.resources)),
    { message: "a key is used by a resource and a PDF attachment", path: ["pdfAttachments"] },
  );

export type TemplateBundle = z.infer<typeof templateBundleSchema>;
