import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { FileAttachmentRef } from "../renderer-foundation/index.js";

// A string is an image the body embeds by key (the fileRef id); an object is a file attached to
// the mail as-is. Images are the only thing a document body can reference.
export type LinkedResourceEntry = string | FileAttachmentRef;

export function isFileAttachmentEntry(entry: LinkedResourceEntry): entry is FileAttachmentRef {
  return typeof entry !== "string";
}

function toLinkedResourceEntry(raw: unknown): LinkedResourceEntry | null {
  if (typeof raw === "string") return raw;
  if (!isPlainObject(raw)) return null;
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

export function imageResourceKeysOf(raw: string | null): string[] {
  return Object.keys(imageLinksOf(parseLinkedResourceEntries(raw)));
}
