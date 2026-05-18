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

const treeProvider: TreeChildrenSubscribe = (_ctx) => (emit) => {
  const allBlocks = [...LEGAL_REQUIRED_BLOCKS, ...LEGAL_OPTIONAL_BLOCKS];
  const nodes: readonly TreeNode[] = allBlocks.map((b) => ({
    label: `${b.slug} (${b.lang})`,
    target: {
      featureId: "text-content",
      action: "edit",
      args: { slug: b.slug, lang: b.lang },
    },
  }));
  emit(nodes);
  return () => {};
};

export function legalPagesClient(): ClientFeatureDefinition {
  return {
    name: "legal-pages",
    treeProvider,
  };
}
