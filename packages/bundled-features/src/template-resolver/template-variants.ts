import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";

export const VARIANT_SEPARATOR = ":";
export const VARIANT_KIND = "document-pdf" as const;
export const VARIANT_NAME_MAX_LENGTH = 40;

// One kebab segment: the variant slug is `<base>:<name>` and a second ":" would read as another base.
export const variantNameSchema = z
  .string()
  .min(1)
  .max(VARIANT_NAME_MAX_LENGTH)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be kebab-case (lowercase, digits, dashes)");

export function variantSlug(baseSlug: string, name: string): string {
  return `${baseSlug}${VARIANT_SEPARATOR}${name}`;
}

export function isVariantSlugOf(slug: string, baseSlug: string): boolean {
  const prefix = `${baseSlug}${VARIANT_SEPARATOR}`;
  return slug.startsWith(prefix) && variantNameSchema.safeParse(slug.slice(prefix.length)).success;
}

// Stored meta is untrusted JSON; only a string counts as a base slug.
export function readVariantOf(meta: unknown): string | null {
  const variantOf = propertyOf(meta, "variantOf");
  return typeof variantOf === "string" ? variantOf : null;
}

export function variantOfMatchesSlug(slug: string, meta: unknown): boolean {
  const variantOf = readVariantOf(meta);
  return variantOf === null || isVariantSlugOf(slug, variantOf);
}

// German special letters are transliterated and the rest kebab-cased, so any title yields a valid name.
export function variantNameFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, VARIANT_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
}
