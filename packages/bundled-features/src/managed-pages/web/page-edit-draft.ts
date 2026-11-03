import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { effectiveBodyFormat } from "./constants.ts";
import { detectLossyMarkdown, type LossyMarkdownFeature } from "./lossy-markdown.ts";
import { markdownToDocumentHtml } from "./markdown-to-document.ts";

export type PageDraft = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly description: string;
  readonly ogImage: string;
  readonly published: boolean;
  /** The body as the editor shows it: always a document, a Markdown page is converted on open. */
  readonly bodyHtml: string;
};

export type PageRecord = {
  readonly id: string;
  readonly version: number;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly description: string | null;
  readonly ogImage: string | null;
  readonly published: boolean;
  readonly body: string | null;
  readonly bodyFormat: string | null;
};

export const EMPTY_PAGE_DRAFT: PageDraft = {
  slug: "",
  lang: "en",
  title: "",
  description: "",
  ogImage: "",
  published: false,
  bodyHtml: "",
};

export function draftOfRecord(record: PageRecord): PageDraft {
  const body = record.body ?? "";
  return {
    slug: record.slug,
    lang: record.lang,
    title: record.title,
    description: record.description ?? "",
    ogImage: record.ogImage ?? "",
    published: record.published,
    bodyHtml:
      effectiveBodyFormat(record.bodyFormat) === "markdown" ? markdownToDocumentHtml(body) : body,
  };
}

// What opening a Markdown page would lose; nothing is converted in storage until the user saves.
export function lossyFeaturesOfRecord(record: PageRecord): readonly LossyMarkdownFeature[] {
  return effectiveBodyFormat(record.bodyFormat) === "markdown"
    ? detectLossyMarkdown(record.body ?? "")
    : [];
}

export function isDraftDirty(draft: PageDraft, initial: PageDraft): boolean {
  return (
    draft.slug !== initial.slug ||
    draft.lang !== initial.lang ||
    draft.title !== initial.title ||
    draft.description !== initial.description ||
    draft.ogImage !== initial.ogImage ||
    draft.published !== initial.published ||
    draft.bodyHtml !== initial.bodyHtml
  );
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

/** Create payload: every field. Update payload: only what differs, as the update handler expects. */
export function createPayloadOf(draft: PageDraft): Readonly<Record<string, unknown>> {
  return {
    slug: draft.slug,
    lang: draft.lang,
    title: draft.title,
    description: nullable(draft.description),
    ogImage: nullable(draft.ogImage),
    published: draft.published,
    body: nullable(draft.bodyHtml),
    bodyFormat: "document",
  };
}

export function changesOf(draft: PageDraft, initial: PageDraft): Readonly<Record<string, unknown>> {
  const all = createPayloadOf(draft);
  const before = createPayloadOf(initial);
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(all)) {
    if (field === "bodyFormat") continue;
    if (value !== before[field]) changes[field] = value;
  }
  // The body of a Markdown page is stored as a document once it is edited or converted on save.
  if ("body" in changes) changes["bodyFormat"] = "document";
  return changes;
}

/** The create handler answers `{ id }`; anything else means the id is unknown and the list opens. */
export function createdIdOf(data: unknown): string | undefined {
  const id = propertyOf(data, "id");
  return typeof id === "string" ? id : undefined;
}
