import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import type { FileAttachmentRef } from "../renderer-foundation/index.ts";
import { pdfAttachmentFileNamePatternSchema, templateSlugSchema } from "./template-meta.ts";

export const templatePdfAttachmentLinkSchema = z
  .object({
    kind: z.literal("rendered-pdf"),
    templateSlug: templateSlugSchema,
    fileName: pdfAttachmentFileNamePatternSchema,
  })
  .strict();

// A PDF the mail renderer asks for at send time: the document template is rendered with the
// mail's variables, so nothing is stored. `fileName` is a pattern that may hold {{placeholders}}.
export type TemplatePdfAttachmentLink = z.infer<typeof templatePdfAttachmentLinkSchema>;

// A string is an image the body embeds by key (the fileRef id); an object is a file attached to
// the mail as-is or a PDF rendered from a document template. Images are the only thing a document
// body can reference.
export type LinkedResourceEntry = string | FileAttachmentRef | TemplatePdfAttachmentLink;

export function isFileAttachmentEntry(entry: LinkedResourceEntry): entry is FileAttachmentRef {
  return typeof entry !== "string" && entry.kind === "file";
}

export function isPdfAttachmentLink(
  entry: LinkedResourceEntry,
): entry is TemplatePdfAttachmentLink {
  return typeof entry !== "string" && entry.kind === "rendered-pdf";
}

function toLinkedResourceEntry(raw: unknown): LinkedResourceEntry | null {
  if (typeof raw === "string") return raw;
  if (!isPlainObject(raw)) return null;
  if (raw["kind"] === "rendered-pdf") {
    const link = templatePdfAttachmentLinkSchema.safeParse(raw);
    return link.success ? link.data : null;
  }
  const { fileRefId, fileName } = raw;
  if (raw["kind"] !== "file" || typeof fileRefId !== "string" || typeof fileName !== "string") {
    return null;
  }
  return { kind: "file", fileRefId, fileName };
}

export function parseLinkedResourceEntries(
  raw: string | null,
): Record<string, LinkedResourceEntry> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const entries: Record<string, LinkedResourceEntry> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = toLinkedResourceEntry(value);
    if (entry !== null) entries[key] = entry;
  }
  return entries;
}

export function imageLinksOf(
  entries: Readonly<Record<string, LinkedResourceEntry>>,
): Record<string, string> {
  const images: Record<string, string> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry === "string") images[key] = entry;
  }
  return images;
}

export function fileAttachmentsOf(
  entries: Readonly<Record<string, LinkedResourceEntry>>,
): FileAttachmentRef[] {
  return Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, entry]) => (isFileAttachmentEntry(entry) ? [entry] : []));
}

export function pdfAttachmentLinksOf(
  entries: Readonly<Record<string, LinkedResourceEntry>>,
): TemplatePdfAttachmentLink[] {
  return Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, entry]) => (isPdfAttachmentLink(entry) ? [entry] : []));
}

export function attachmentEntriesOf(
  entries: Readonly<Record<string, LinkedResourceEntry>>,
): [string, FileAttachmentRef | TemplatePdfAttachmentLink][] {
  return Object.entries(entries).flatMap(([key, entry]) =>
    typeof entry === "string" ? [] : [[key, entry]],
  );
}

export function imageResourceKeysOf(raw: string | null): string[] {
  return Object.keys(imageLinksOf(parseLinkedResourceEntries(raw)));
}
