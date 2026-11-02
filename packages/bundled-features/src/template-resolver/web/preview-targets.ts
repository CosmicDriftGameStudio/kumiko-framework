import type { PreviewTarget } from "@cosmicdrift/kumiko-renderer";
import type { EditableTemplateKind } from "./constants.ts";

// Complete on purpose: a new kind breaks the typecheck until it gets a target or is excluded
// from `EditableTemplateKind`. `snippet` covers every entry of an app's content collections; `text-block` has one
// consumer (legal-pages), so only "web" until a consumer puts snippets into mails.
export const previewTargetOfKind: Readonly<Record<EditableTemplateKind, PreviewTarget>> = {
  mail: "mail",
  "document-pdf": "pdf",
  "mail-layout": "mail",
  "pdf-layout": "pdf",
  "text-block": "web",
  snippet: "text",
  "ai-prompt": "text",
};

function isEditableKind(kind: string): kind is EditableTemplateKind {
  return Object.hasOwn(previewTargetOfKind, kind);
}

/** A collection declares its kind as an opaque string; one this map does not know previews as plain text. */
export function previewTargetOfCollectionKind(kind: string | undefined): PreviewTarget {
  if (kind === undefined || !isEditableKind(kind)) return "text";
  return previewTargetOfKind[kind];
}
