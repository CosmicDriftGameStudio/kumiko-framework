import * as z from "zod";
import { CONTENT_FORMATS, UPSERT_KINDS } from "./constants.js";
import { isDocumentResourceKey } from "./document-schema.js";
import { templateSlugSchema } from "./template-meta.js";

const MAX_RESOURCES = 20;
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
  })
  .strict();

const bundleLocaleEntrySchema = z
  .object({ body: z.string().max(200_000), meta: z.unknown().optional() })
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
  })
  .strict();

export type TemplateBundle = z.infer<typeof templateBundleSchema>;
