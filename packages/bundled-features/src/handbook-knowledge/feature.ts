import {
  type AccessRule,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { HANDBOOK_KNOWLEDGE_FEATURE } from "./constants.ts";
import { createHandbookIndex } from "./handbook-index.ts";
import { createListPagesQuery, createReadPageQuery } from "./handlers.ts";

export type HandbookKnowledgeOptions = {
  /** The JSON written by `kumiko handbuch knowledge`; validated once at boot. */
  pages: unknown;
  access: AccessRule;
  /** Where the public handbook lives (e.g. "/handbuch"); page links are `<publicPath>/<id>`, with or without a trailing slash. */
  publicPath?: string;
};

export function createHandbookKnowledgeFeature(
  options: HandbookKnowledgeOptions,
): FeatureDefinition {
  const index = createHandbookIndex(options.pages);
  return defineFeature(HANDBOOK_KNOWLEDGE_FEATURE, (r) => {
    r.describe(
      "Gives the AI agent the app's handbook as two read-only query tools: `list-pages` returns the catalog of task and screen pages with the questions each answers, `read-page` returns one page in the caller's language with a fallback to the default language and a fixed length cap. The pages come from a build-time JSON (`kumiko handbuch knowledge`), so no table, projection or search index is involved and the handbook text stays public content.",
    );
    r.uiHints({
      displayLabel: "Handbook Knowledge",
      category: "ai",
      recommended: false,
    });
    r.queryHandler(createListPagesQuery(index, options.access));
    r.queryHandler(createReadPageQuery(index, options.access, options.publicPath));
  });
}
