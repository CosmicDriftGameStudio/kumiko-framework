// Defines the shape of client extensions supplied by features. Server features
// (`defineFeature`) register handlers, projections, and hooks; client features
// register context providers and gate wrappers. `createKumikoApp` composes them
// into the React tree in a defined order.
//
// The providers/gates split lets features that need a gate themselves (for
// example, AuthGate → LoginScreen) still access other features' contexts: all
// providers are composed outermost, followed by all gates. Every gate can
// therefore access every provider, regardless of which feature supplied it.

import type { TargetRef, TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import type { ContentEditorFormat } from "@cosmicdrift/kumiko-types/nav";
import type { ComponentType, ReactNode } from "react";
import type {
  ClientActionHandler,
  ColumnRendererComponent,
  ContentEditorComponent,
  ExtensionSectionComponent,
  QualifiedContentCollection,
  TranslationsByLocale,
} from "../../index.ts";

/** What a `navProvidersFromCollections` factory returns: the providers plus
 *  the entities whose live events should re-fire them. Without `entities` a
 *  derived tree would sit stale until re-mount — the hand-wired path has the
 *  SSE refresh and the derived one must not lose it. */
export type CollectionNavProviders = {
  readonly providers: Readonly<Record<string, TreeChildrenSubscribe>>;
  readonly entities?: Readonly<Record<string, readonly string[]>>;
};

export type ClientFeatureDefinition = {
  readonly name: string;
  /** Context providers wrapped around the complete renderer tree. The first
   * array element is the outermost provider. All providers precede all gates
   * in the tree so every gate and screen child can access them. */
  readonly providers?: readonly ComponentType<{ children: ReactNode }>[];
  /** Screen decorators placed between the provider stack and the shell or
   * screen render. A typical pattern is AuthGate rendering LoginScreen
   * instead of children while the user is not signed in. The first array
   * element is the outermost gate. */
  readonly gates?: readonly ComponentType<{ children: ReactNode }>[];
  /** Default translations supplied by the feature for its UI strings. They
   * are added to the LocaleProvider as a fallback bundle; the app resolver
   * (for example, i18next) takes precedence and can override individual keys
   * without replacing the feature bundles entirely. */
  readonly translations?: TranslationsByLocale;
  /** Custom screen components, mapped by screenId. When a schema screen has
   * `type: "custom"`, KumikoScreen looks up and renders the matching component
   * in this map, merged from all client features. This keeps routing out of
   * the AppShell wrapper. The convention is that screenId matches the `id` in
   * `r.screen({ id, type: "custom", ... })` in the server-side feature. */
  readonly components?: Readonly<Record<string, ComponentType>>;
  /** Column renderer components, mapped by renderer name. A schema declares a
   * column with `renderer: { react: { __component: "ColorSwatch" } }`; the
   * client-side DataTable cell renderer looks up the component here. Schemas
   * remain serializable because only a string key crosses the wire, while the
   * actual JSX renderers live in the client bundle. Later features win on key
   * collisions. */
  readonly columnRenderers?: Readonly<Record<string, ColumnRendererComponent>>;
  /** Extension-section components, mapped by `__component` name. A schema
   * declares an entityEdit section with `kind: "extension"` and
   * `component: { react: { __component: "X" } }`; RenderEdit looks up and
   * mounts the component here with `{ entityName, entityId }`. As with
   * columnRenderers, later features win on key collisions. */
  readonly extensionSectionComponents?: Readonly<Record<string, ExtensionSectionComponent>>;
  /** Handlers for RowAction `kind: "clientAction"`, keyed by the action name
   *  `<feature>:<kebab>`. Last-wins with a warning on key collisions, like
   *  columnRenderers. */
  readonly clientActions?: Readonly<Record<string, ClientActionHandler>>;
  /** Nav providers for the single nav visual-tree merge: they attach dynamic
   * children to a static `r.nav({ provider: true })` node. Keys use the local
   * nav ID; create-app qualifies it as `<feature>:nav:<id>`, while already
   * qualified names pass through. Unlike `treeProvider`, which creates one
   * top-level branch per feature, a navProvider attaches to a specific nav
   * node—the idiomatic approach since the tree-to-nav merge. */
  readonly navProviders?: Readonly<Record<string, TreeChildrenSubscribe>>;
  /** SSE entity lists per nav ID for live refresh of navProviders, analogous
   * to `treeEntities`. A live event for an entity re-invokes the node's
   * provider so new children appear immediately. */
  readonly navEntities?: Readonly<Record<string, readonly string[]>>;
  /** Nav providers derived from the app schema — called with every
   *  `r.contentCollection()` the app declares. A feature that serves any
   *  number of collections (template-resolver) builds one provider per
   *  collection this way, without the app writing navId + kind a second time
   *  and without the renderer having to know bundled-features. Merged with
   *  `navProviders`; the static map wins on key collision (explicit beats
   *  derived). */
  readonly navProvidersFromCollections?: (
    collections: readonly QualifiedContentCollection[],
  ) => CollectionNavProviders;

  /** Content editor components — map `contentFormat` ("plain" | "rich" | "markdown" | "document") →
   *  React component. `r.contentCollection()` declares which format an
   *  editor edits; the collection's editor UI (template-resolver's
   *  TextBlockEditor et al.) looks the component up here and falls back to
   *  a plain textarea when no clientFeature registered one for that
   *  format. Same last-wins semantics as columnRenderers. Public component
   *  contract: `{ value, onChange, variables, readOnly }`. */
  readonly contentEditors?: Partial<Record<ContentEditorFormat, ContentEditorComponent>>;

  /** Editor resolver components keyed by featureId:action. When a TreeNode
   * with a target is clicked, EditorPanel looks up and renders the component
   * here. Components receive target (with args) and an onClose callback. If
   * no resolver is registered, EditorPanel shows an informational fallback. */
  readonly resolvers?: Readonly<
    Record<string, ComponentType<{ readonly target: TargetRef; readonly onClose: () => void }>>
  >;
};

/** Wraps a ReactNode with a list of providers or gates from inside out; the
 * first array element is the outermost wrapper. The key uses the component's
 * display name, when available, plus its index, keeping mounts stable while
 * the wrapper list's order does not change. */
export function stackWrappers(
  wrappers: readonly ComponentType<{ children: ReactNode }>[],
  inner: ReactNode,
): ReactNode {
  return wrappers.reduceRight<ReactNode>((acc, Wrapper, i) => {
    const key = `${Wrapper.displayName ?? Wrapper.name ?? "wrapper"}-${i}`;
    return <Wrapper key={key}>{acc}</Wrapper>;
  }, inner);
}
