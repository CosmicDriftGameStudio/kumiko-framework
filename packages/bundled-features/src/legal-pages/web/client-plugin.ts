// @runtime client
// Client-Feature-Factory für legal-pages Visual-Tree. Liefert statische
// Tree-Knoten für die DACH-Compliance-Blöcke (imprint, privacy in de/en).
// Jeder Knoten linkt auf text-content's edit-Action — reines Cross-Feature-
// Linking, kein eigener State oder Fetch nötig.
//
// **Static statt fetch**: legal-pages weiß out-of-the-box welche Blocks
// existieren (LEGAL_REQUIRED_BLOCKS + LEGAL_OPTIONAL_BLOCKS aus constants).
// Anders als text-content's Provider (der alle Slugs des Tenants holt)
// ist diese Liste bekannt zur Build-Zeit — kein /api/query-Round-trip nötig.
//
// **Content-State unbekannt**: V.1.2 setzt keine state-Markierung; alle
// Knoten erscheinen "filled" (default). V.1.3+ könnte via by-slug-Query
// ermitteln ob ein Block tatsächlich body hat und „stub" markieren wenn
// leer (Provider-Author-Hinweis dass Block existiert aber befüllt werden
// muss). Aktuell ist legal-pages's Boot-Check der primäre Wächter für
// fehlende Pflicht-Blocks.

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { LEGAL_OPTIONAL_BLOCKS, LEGAL_REQUIRED_BLOCKS } from "../constants";

const treeProvider: TreeChildrenSubscribe = () => (emit) => {
  // V.1.5d Slug-first Verschachtelung (Variante C):
  //   📁 Legal
  //     📁 imprint
  //       de
  //       en
  //     📁 privacy
  //       de
  //       en
  //
  // Slug ist der Übersetzungs-Anker — User pflegt DE+EN-Versionen
  // desselben Inhalts zusammen statt nach Sprache zu gruppieren.
  // Sub-Items sind reine Sprach-Leaves; Label = Sprache, target zeigt
  // auf text-content:edit mit slug+lang.

  // Group all blocks by slug, collect set of langs per slug.
  const bySlug = new Map<string, string[]>();
  for (const b of [...LEGAL_REQUIRED_BLOCKS, ...LEGAL_OPTIONAL_BLOCKS]) {
    const langs = bySlug.get(b.slug) ?? [];
    if (!langs.includes(b.lang)) langs.push(b.lang);
    bySlug.set(b.slug, langs);
  }

  const slugFolders: TreeNode[] = [];
  for (const slug of [...bySlug.keys()].sort()) {
    const langs = bySlug.get(slug);
    if (langs === undefined) continue;
    const langLeaves: TreeNode[] = langs.sort().map((lang) => ({
      label: lang,
      target: {
        featureId: "text-content",
        action: "edit",
        args: { slug, lang },
      },
    }));
    slugFolders.push({
      label: slug,
      icon: "folder",
      state: "filled",
      children: langLeaves,
    });
  }

  emit([
    {
      label: "Legal",
      icon: "folder",
      state: "filled",
      children: slugFolders,
    },
  ]);
  return () => {};
};

export function legalPagesClient(): ClientFeatureDefinition {
  return {
    name: "legal-pages",
    treeProvider,
  };
}
