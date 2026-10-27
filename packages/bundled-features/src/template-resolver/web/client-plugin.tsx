import { type ClientFeatureDefinition, PlainContentEditor } from "@cosmicdrift/kumiko-renderer/web";
import { CollectionEntryCreateForm } from "./collection-entry-create-form.tsx";
import { makeTreeProvider } from "./content-tree-provider.ts";
import { DocumentContentEditor } from "./document-editor.tsx";
import { defaultTranslations } from "./i18n.ts";
import { TextBlockEditor } from "./text-block-editor.tsx";

// `navId` = the QN of the r.nav({ provider: true }) node the app registers for
// the content tree (e.g. "publicstatus:nav:content"). The app owns the node's
// label/icon/access, the feature only supplies children plus the editor.
// Without navId: resolver only, no sidebar node (server-only consumers such as
// money-horse leak nothing).
// `tenantId`: which tenant a SystemAdmin's trees and editor serve —
// SYSTEM_TENANT_ID for apps that seed marketing/legal there. Other users and
// per-user collections always stay on the session tenant. Omit for the
// session tenant everywhere.
//
// Beyond that single tree, this client also serves every content collection
// the app declares via r.contentCollection() — one provider per collection,
// filtered to its kind. Those need no navId here; their nav QN comes from the
// schema, so navId and kind can't drift apart.
export function textBlocksClient(opts?: {
  readonly navId?: string;
  readonly tenantId?: string;
}): ClientFeatureDefinition {
  const navId = opts?.navId;
  const tenantId = opts?.tenantId;
  return {
    name: "template-resolver",
    ...(navId !== undefined && {
      navProviders: { [navId]: makeTreeProvider(tenantId) },
      // SSE refresh: every template-resource event re-fires the provider.
      navEntities: { [navId]: ["template-resource"] },
    }),
    // Every r.contentCollection() in the app gets its own tree, filtered to
    // that collection's kind. The explicit navId above stays independent of
    // this — an app can have both a hand-wired content tree and collections.
    navProvidersFromCollections: (collections) => ({
      providers: Object.fromEntries(
        collections.map((c) => [c.navQn, makeTreeProvider(tenantId, c)]),
      ),
      entities: Object.fromEntries(collections.map((c) => [c.navQn, ["template-resource"]])),
    }),
    resolvers: {
      "template-resolver:edit": TextBlockEditor,
      "template-resolver:create": CollectionEntryCreateForm,
    },
    // An app-registered editor for a format on another clientFeature still wins,
    // last-wins same as columnRenderers.
    contentEditors: {
      plain: PlainContentEditor,
      document: DocumentContentEditor,
    },
    translations: defaultTranslations,
  };
}
