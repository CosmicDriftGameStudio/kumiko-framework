import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { bySlugQuery } from "./handlers/by-slug.query";
import { setWrite } from "./handlers/set.write";
import { textBlockEntity } from "./table";

// text-content — generischer Container für statische Texte (Impressum,
// Datenschutz, FAQ, About, ToS, Marketing-Snippets). Pro
// (tenantId, slug, lang) genau ein Block. Inhalt ist Markdown — die
// Konvertierung zu HTML übernehmen Consumer-Features wie legal-pages
// (das opt-in obendrauf-Feature für Compliance-Pages).
//
// Opt-in: wer keine statischen Texte braucht (interne Tools), aktiviert
// das Feature gar nicht. Wer es aktiviert, hat sofort CRUD + by-slug-
// query — Routes/Render kommen pro Use-Case (legal-pages, etc.).
export function createTextContentFeature(): FeatureDefinition {
  return defineFeature("text-content", (r) => {
    r.entity("text-block", textBlockEntity);

    const handlers = {
      set: r.writeHandler(setWrite),
    };

    const queries = {
      bySlug: r.queryHandler(bySlugQuery),
    };

    return { handlers, queries };
  });
}
