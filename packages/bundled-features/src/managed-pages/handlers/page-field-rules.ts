import * as z from "zod";
import { isSafeHttpsUrl } from "../../page-render/index.ts";

export const pageSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

export const pageLangSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "lang must be ISO 639-1 (e.g. de, en, en-us)");

// "" stays valid (means: not set) so an emptied form field does not block the save.
export const pageOgImageSchema = z
  .string()
  .max(2000)
  .refine((value) => value === "" || isSafeHttpsUrl(value), {
    message: "ogImage must be an https URL",
  });

// Applied to the fields a convention CRUD payload carries; set.write uses the single schemas directly.
export const pageAddressFieldsSchema = z.object({
  slug: pageSlugSchema.optional(),
  lang: pageLangSchema.optional(),
  ogImage: pageOgImageSchema.nullable().optional(),
});
