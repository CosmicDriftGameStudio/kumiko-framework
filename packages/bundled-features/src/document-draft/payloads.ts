import * as z from "zod";
import { documentOpsSchema, localeSchema, templateSlugSchema } from "../template-resolver/index.ts";
import {
  DOCUMENT_DRAFT_DEFAULT_LOCALE,
  DOCUMENT_DRAFT_MAX_CONTENT_LENGTH,
} from "./web/constants.ts";

const draftIdSchema = z.uuid();
const baseVersionSchema = z.number().int().nonnegative();
const subjectIdSchema = z.string().min(1).max(100);

export const DraftIdSchema = z.object({ id: draftIdSchema });

// `base` is the draft's version as the caller read it; a stale base fails with version_conflict.
export const DraftBaseSchema = z.object({ id: draftIdSchema, base: baseVersionSchema });

export const PatchDraftSchema = z.object({
  id: draftIdSchema,
  base: baseVersionSchema,
  ops: documentOpsSchema,
});

export const SaveDraftSchema = z.object({
  id: draftIdSchema,
  base: baseVersionSchema,
  content: z.string().max(DOCUMENT_DRAFT_MAX_CONTENT_LENGTH),
});

export const BySubjectSchema = z.object({
  subjectType: z.string().min(1).max(100),
  subjectId: subjectIdSchema,
});

export function createDraftSchema(subjectTypes: readonly [string, ...string[]]) {
  return z.object({
    subjectType: z.enum(subjectTypes),
    subjectId: subjectIdSchema,
    templateSlug: templateSlugSchema,
    /** Slug of a variant of `templateSlug` (`<templateSlug>:<name>`), used instead of the base. */
    variant: templateSlugSchema.optional(),
    locale: localeSchema.default(DOCUMENT_DRAFT_DEFAULT_LOCALE),
    /** Values of the placeholders, frozen with the draft; they stay personal data of the draft. */
    variables: z.record(z.string(), z.unknown()),
  });
}
