// Client feature factory for the legal-pages visual tree. Provides static
// tree nodes for the DACH compliance blocks (imprint, privacy in de/en).
// Each node links to text-content's edit action — pure cross-feature
// linking, with no own state or fetch required.
//
// **Static instead of fetch**: legal-pages knows out of the box which blocks
// exist (LEGAL_REQUIRED_BLOCKS + LEGAL_OPTIONAL_BLOCKS from constants).
// Unlike text-content's provider (which fetches all tenant slugs), this list
// is known at build time — no /api/query round trip is needed.
//
// **Content state unknown**: no state marker is set; all nodes appear
// "filled" (default). A by-slug query could determine whether a block
// actually has a body and mark it as "stub" when empty (a provider-author hint
// that the block exists but must be filled). Currently, legal-pages's boot
// check is the primary guard for missing required blocks.

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { LEGAL_OPTIONAL_BLOCKS, LEGAL_REQUIRED_BLOCKS } from "./constants.ts";

const treeProvider: TreeChildrenSubscribe = () => (emit) => {
  // Slug-first nesting:
  //   📁 Legal
  //     📁 imprint
  //       de
  //       en
  //     📁 privacy
  //       de
  //       en
  //
  // The slug is the translation anchor — users maintain the DE+EN versions
  // of the same content together instead of grouping them by language.
  // Sub-items are language-only leaves; label = language, and target points
  // to template-resolver:edit with slug+locale.

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
        featureId: "template-resolver",
        action: "edit",
        args: { slug, locale: lang },
      },
    }));
    slugFolders.push({
      label: slug,
      icon: "folder",
      state: "filled",
      children: langLeaves,
    });
  }

  // The app-side r.nav node IS the "Legal" container → the provider
  // emits the slug folders directly beneath it.
  emit(slugFolders);
  return () => {};
};

// `navId` = the QN of the r.nav({ provider: true }) node registered by the app.
// Static (no fetch, no entities) → no SSE refresh is needed. Without navId:
// no sidebar node (server-only consumers expose nothing).
export function legalPagesClient(opts?: { readonly navId?: string }): ClientFeatureDefinition {
  const navId = opts?.navId;
  return {
    name: "legal-pages",
    ...(navId !== undefined && { navProviders: { [navId]: treeProvider } }),
  };
}
