import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { bySlugQuery } from "./handlers/by-slug.query";
import { byTenantQuery } from "./handlers/by-tenant.query";
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
// query + by-tenant-list-query — Routes/Render kommen pro Use-Case
// (legal-pages, Visual-Tree, etc.).
//
// **Visual-Tree-Integration (V.1.2)**: r.treeActions deklariert die
// Edit-Actions für Cross-Feature-Linking via buildTarget. Der Handle
// wird via setup-export propagiert (Memory `[EventDef-Exports-Pattern]`),
// sodass andere Features compile-time-typed Cross-Feature-Edits triggern
// können — siehe legal-pages's TreeProvider der text-content:edit als
// Target nutzt. Der Client-side TreeProvider lebt in `web/client-plugin.ts`.
export function createTextContentFeature() {
  return defineFeature("text-content", (r) => {
    r.entity("text-block", textBlockEntity);

    const handlers = {
      set: r.writeHandler(setWrite),
    };

    const queries = {
      bySlug: r.queryHandler(bySlugQuery),
      byTenant: r.queryHandler(byTenantQuery),
    };

    const treeHandle = r.treeActions({
      edit: { args: { slug: "" as string, lang: "" as string } },
      list: {},
      create: { args: { folder: "" as string } },
    });

    return { handlers, queries, treeHandle };
  });
}
