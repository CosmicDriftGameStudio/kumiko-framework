import { compareIds } from "../labels.ts";
import type { PageAnchor } from "./markdown.ts";
import type { ApiDocsSource } from "./model.ts";

export type ApiDocsPageKind = "overview" | "tokens" | "reference" | "events";

export type ApiDocsPageEntry = {
  readonly path: string;
  readonly locale: string;
  readonly kind: ApiDocsPageKind;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly scope?: string;
  readonly anchors: readonly PageAnchor[];
};

export const INDEX_FILE = "index.json";

export function renderIndexJson(
  source: ApiDocsSource,
  locales: readonly string[],
  pages: readonly ApiDocsPageEntry[],
): string {
  const sorted = [...pages].sort(
    (a, b) => compareIds(a.locale, b.locale) || a.order - b.order || compareIds(a.path, b.path),
  );
  return `${JSON.stringify({ source, locales, pages: sorted }, null, 2)}\n`;
}
