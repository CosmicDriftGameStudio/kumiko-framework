import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import type {
  Dispatcher,
  ListRowViewModel,
  LocaleResolver,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import {
  AppFeaturesProvider,
  type AppSchema,
  ColumnRenderersProvider,
  type ContentEditorComponent,
  ContentEditorsProvider,
  CustomScreensProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  type DraftStorage,
  DraftStorageProvider,
  ExtensionSectionsProvider,
  type FeatureSchema,
  hasDetailScreen,
  KumikoScreen,
  kumikoDefaultTranslations,
  LiveEventsProvider,
  LocaleProvider,
  mergeTranslations,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
  type QualifiedContentCollection,
  qualifyScreenId,
  TokensProvider,
  type TranslationsByLocale,
  toAppSchema,
  translationsByLocaleFromKeys,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import { type ComponentType, type ReactNode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { lastSegment } from "../layout/nav-tree";
import { defaultPrimitives } from "../primitives";
import { ToastProvider } from "../primitives/toast";
import { createEventSourceLiveEvents } from "../sse/live-events";
import { useBrowserTokensApi } from "../tokens";
import { UpdateChecker } from "../version/update-checker";
import { createBrowserLocaleResolver } from "./browser-locale";
import { type ClientFeatureDefinition, stackWrappers } from "./client-plugin";
import { WebDashboardBody } from "./dashboard-body";
import { DocumentLangSync } from "./document-lang-sync";
import { createBrowserDraftStorage } from "./draft-storage";
import { useBrowserNavApi } from "./nav";
import { NavProvidersProvider } from "./nav-providers-context";
import { type ResolverComponent, ResolversProvider } from "./resolvers-context";

// Qualifiziert den Key eines navProviders auf seine Nav-QN. Lokale ids
// (z.B. "content") werden wie in r.nav mit dem Feature-Namen qualifiziert;
// bereits qualifizierte QNs (App registriert die Nav für ein bundled-feature
// und gibt die QN als navId rein, z.B. "publicstatus:nav:content") gehen
// unverändert durch. MUSS konsistent zu qualifyNavId bleiben, sonst findet
// der NavTree-Knoten (Schema-Seite) seinen Provider nicht.
export function qualifyNavProviderKey(feature: string, id: string): string {
  return id.includes(":nav:") ? id : `${feature}:nav:${id}`;
}

// Nav-Provider-Map: ein navProvider hängt dynamische Children an einen
// konkreten r.nav({provider:true})-Knoten (per QN). Lokale nav-ids werden wie
// in r.nav mit dem Feature-Namen qualifiziert; bereits qualifizierte QNs
// (cross-feature, z.B. App registriert Nav für ein bundled-feature) gehen
// unverändert durch.
//
// Schema-derived providers (r.contentCollection) run first and hold the weaker
// claim on a QN — an explicitly registered navProvider overrides them without
// comment. Only two EXPLICIT registrations on the same QN are the conflict
// that deserves the warning.
export function buildNavProviderMaps(
  clientFeatures: readonly ClientFeatureDefinition[],
  collections: readonly QualifiedContentCollection[],
): {
  readonly navProviders: ReadonlyMap<string, TreeChildrenSubscribe>;
  readonly navEntities: ReadonlyMap<string, readonly string[]>;
} {
  const navProviders = new Map<string, TreeChildrenSubscribe>();
  const navEntities = new Map<string, readonly string[]>();
  const derivedQns = new Set<string>();
  for (const f of clientFeatures) {
    if (f.navProvidersFromCollections === undefined) continue;
    const derived = f.navProvidersFromCollections(collections);
    for (const [qn, provider] of Object.entries(derived.providers)) {
      navProviders.set(qn, provider);
      derivedQns.add(qn);
    }
    for (const [qn, entities] of Object.entries(derived.entities ?? {})) {
      if (entities.length > 0) navEntities.set(qn, entities);
    }
  }
  for (const f of clientFeatures) {
    for (const [navId, provider] of Object.entries(f.navProviders ?? {})) {
      const qn = qualifyNavProviderKey(f.name, navId);
      if (navProviders.has(qn) && !derivedQns.delete(qn)) {
        // biome-ignore lint/suspicious/noConsole: dev warning for schema conflicts
        console.warn(
          `[kumiko] navProvider for "${qn}" defined by multiple clientFeatures — last wins.`,
        );
      }
      navProviders.set(qn, provider);
    }
    for (const [navId, entities] of Object.entries(f.navEntities ?? {})) {
      if (entities.length > 0) navEntities.set(qualifyNavProviderKey(f.name, navId), entities);
    }
  }
  return { navProviders, navEntities };
}

// Web-Bootstrap. Mounted den ganzen Kumiko-Render-Stack im Browser:
// Tokens (class-based light/dark via <html>), Primitives (HTML),
// Navigation (window.history), LiveEvents (EventSource), Dispatcher
// (live-HTTP). URL ist Source-of-Truth für den aktuellen Screen.
//
// Typical client.ts:
//
//   createKumikoApp({ schema: clientSchema });

export type CreateKumikoAppOptions = {
  /** App-Schema. Akzeptiert AppSchema (multi-feature) oder die legacy
   *  FeatureSchema (single-feature) — toAppSchema() normalisiert intern.
   *
   *  Optional: ohne Argument liest createKumikoApp das schema aus
   *  `window.__KUMIKO_SCHEMA__`, das der dev-server beim Boot in die
   *  HTML injiziert (siehe @cosmicdrift/kumiko-dev-server: injectSchema).
   *  Production-Apps mit eigenem Bundling-Setup können das Global selbst
   *  setzen (`<script>window.__KUMIKO_SCHEMA__=...</script>` aus einem
   *  build-time bake oder einem fetch). Wer kein Schema übergibt UND
   *  keins im Window vorfindet bekommt einen Fehler beim Mount. */
  readonly schema?: AppSchema | FeatureSchema;
  readonly rootId?: string;
  readonly dispatcher?: Dispatcher;
  /** RenderEdit's create-mode draftId storage (issue #1913) — where a
   *  same-tab reload finds which of several parallel create-sessions on a
   *  screen to resume. Default: `createBrowserDraftStorage()`
   *  (sessionStorage-backed). Apps that don't want any client-side draftId
   *  persistence can pass a no-op impl; RenderEdit still resolves via its
   *  `form-draft:query:list` mount-time fallback either way. */
  readonly draftStorage?: DraftStorage;
  readonly screenQn?: string;
  readonly translate?: Translate;
  /** Row-click fallback for entities with no declared `detailFor` screen
   *  (fw#2164) — a `detailFor` screen always wins over this option. */
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  /** App-Shell. Bekommt das resolved `schema` als Prop — so können
   *  AppShell-Komponenten an WorkspaceShell/DefaultAppShell durchreichen
   *  ohne selbst das Schema zu importieren oder auf window-Globals zu
   *  greifen. */
  readonly shell?: (props: {
    readonly children: ReactNode;
    readonly schema: AppSchema;
  }) => ReactNode;
  readonly primitives?: Partial<PrimitivesRegistry>;
  /** Feature-gelieferte Client-Extensions. Jedes Element bringt
   *  Provider + Gates mit — siehe ClientFeatureDefinition. Beispiel:
   *  `clientFeatures: [emailPasswordClient()]` für Session+Login. */
  readonly clientFeatures?: readonly ClientFeatureDefinition[];
  /** App-level LocaleResolver. Typischerweise ein Adapter um i18next
   *  oder eine eigene Store-Impl. Wenn nicht gesetzt → Static-Default
   *  (`locale: "en"`, `translate: key → key`); Plugin-Translations
   *  springen dann als Fallback ein. */
  readonly locale?: LocaleResolver;
  /** Nav-Adapter — ein React-Hook der eine NavApi-Instanz liefert
   *  (route + navigate + hrefFor). Default: `useBrowserNavApi`, das
   *  window.history als Source-of-Truth benutzt. Wer einen anderen
   *  Router anbinden will (TanStack Router, Expo Linking auf Mobile,
   *  Memory-Router in Tests) übergibt hier seinen eigenen Hook.
   *
   *  Der Hook wird EINMAL im Component-Tree aufgerufen (siehe
   *  `BrowserNavBoot`), muss also den React-Rules-of-Hooks folgen —
   *  `useSyncExternalStore` auf der zugrundeliegenden Router-State
   *  ist das gängige Pattern.
   *
   *  Wenn das Schema Workspaces deklariert, wird der Adapter mit
   *  `{ hasWorkspaces: true }` aufgerufen — der Default-Hook nutzt das
   *  um das URL-Pattern auf `/<workspace>/<screen>[/<entityId>]`
   *  umzustellen. Eigene Adapter dürfen die Option ignorieren wenn ihr
   *  Router das anders löst. `features` ist `app.features` — der
   *  Default-Hook braucht sie für resolveTarget() (ObjectTarget →
   *  ScreenTarget); eigene Adapter die nie ein ObjectTarget bekommen,
   *  dürfen sie ignorieren. */
  readonly navAdapter?: (options?: {
    readonly hasWorkspaces?: boolean;
    readonly features?: readonly FeatureSchema[];
  }) => NavApi;
};

// Reads the dev-server-injected schema from the global. Guarded for
// SSR/node — die Funktion läuft heute nur im Browser, aber das schadet
// auch unter jsdom nicht.
function readInjectedSchema(): AppSchema | FeatureSchema | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { __KUMIKO_SCHEMA__?: AppSchema | FeatureSchema };
  return w.__KUMIKO_SCHEMA__;
}

// Erstes Screen über alle Features in deklarierter Reihenfolge, dessen
// `access` niemanden ausschließt (undefined oder openToAll). Die Landing-
// Route wird VOR Auth-Resolution gewählt, kennt also keine User-Rollen —
// ein role-restricted Screen (z.B. bundled user/tenant, SystemAdmin-only)
// darf hier nie gewinnen, sonst landet jeder Nicht-Admin auf einem
// Access-Denied-Screen (#1176).
// Also requires the screen be reachable via r.nav, otherwise a dormant
// `type: "custom"` screen a feature only registers for manual app-side
// placement (e.g. auth-mfa's enable screen) can win by declaration order
// alone, landing every app without an explicit `screenQn` on a screen
// nobody wired a component for (#1258).
export function firstOpenScreenQn(features: readonly FeatureSchema[]): string | undefined {
  // NavDefinition.screen carries two shapes in practice: most bundled
  // features author it pre-qualified ("tenant:screen:members"), but the
  // config settings-hub generator emits the bare short id. Index both
  // forms so nav-reachability doesn't depend on which convention a given
  // feature happens to use.
  const navScreenQns = new Set<string>();
  for (const f of features) {
    for (const n of f.navs ?? []) {
      if (n.screen === undefined) continue;
      navScreenQns.add(n.screen);
      navScreenQns.add(qualifyScreenId(f.featureName, n.screen));
    }
  }
  for (const feature of features) {
    const openScreen = feature.screens.find(
      (s) =>
        (s.access === undefined || "openToAll" in s.access) &&
        navScreenQns.has(qualifyScreenId(feature.featureName, s.id)),
    );
    if (openScreen !== undefined) return qualifyScreenId(feature.featureName, openScreen.id);
  }
  return undefined;
}

// Last-wins merge for a clientFeature-contributed map (contentEditors,
// columnRenderers, extensionSectionComponents, ...): later features in
// `clientFeatures` override earlier ones on key collision, logging once
// per collision so an accidental override isn't silent.
function mergeByKey<T>(
  clientFeatures: readonly ClientFeatureDefinition[],
  pick: (f: ClientFeatureDefinition) => Record<string, T> | undefined,
  label: string,
): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const f of clientFeatures) {
    const entries = pick(f);
    if (entries === undefined) continue;
    for (const [key, value] of Object.entries(entries)) {
      if (merged[key] !== undefined) {
        // biome-ignore lint/suspicious/noConsole: dev warning for schema conflicts
        console.warn(
          `[kumiko] ${label} "${key}" defined by multiple clientFeatures — last definition (from "${f.name}") wins.`,
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}

// Merges the content-editor map — same last-wins semantics as
// columnRenderers. No entry for a contentFormat → useContentEditor falls
// back to the textarea on its own, no warning needed.
export function mergeContentEditors(
  clientFeatures: readonly ClientFeatureDefinition[],
): Record<string, ContentEditorComponent> {
  return mergeByKey(clientFeatures, (f) => f.contentEditors, "contentEditor");
}

export function createKumikoApp(options: CreateKumikoAppOptions = {}): { readonly root: Root } {
  const rootId = options.rootId ?? "root";
  const container = document.getElementById(rootId);
  if (!container) {
    throw new Error(
      `createKumikoApp: DOM element #${rootId} not found. Make sure your HTML has a matching <div id="${rootId}"></div> before the bundle loads.`,
    );
  }

  // Resolve das Schema. Reihenfolge:
  //   1. options.schema explizit übergeben → nutzen
  //   2. window.__KUMIKO_SCHEMA__ (vom dev-server injiziert) → nutzen
  //   3. Sonst → throw mit klarer Anleitung was zu tun ist
  // toAppSchema normalisiert die FeatureSchema/AppSchema-Union, ab hier
  // kennen alle Layouts nur noch AppSchema.
  const rawSchema = options.schema ?? readInjectedSchema();
  if (rawSchema === undefined) {
    throw new Error(
      "createKumikoApp: kein Schema übergeben und window.__KUMIKO_SCHEMA__ nicht gesetzt. " +
        "Entweder `schema: <FeatureSchema|AppSchema>` an createKumikoApp übergeben, oder " +
        "den dev-server (@cosmicdrift/kumiko-dev-server) nutzen — der injiziert das Schema beim Boot.",
    );
  }
  const app = toAppSchema(rawSchema);

  // Fallback-Screen falls kein explizites screenQn übergeben wurde.
  const fallbackQn = options.screenQn ?? firstOpenScreenQn(app.features);
  if (!fallbackQn) {
    throw new Error(
      "createKumikoApp: schema contains no screens accessible without a role restriction. Add at least one entry to `schema.screens` without `access.roles`, or pass `screenQn` explicitly.",
    );
  }

  const dispatcher = options.dispatcher ?? createLiveDispatcher();
  const draftStorage = options.draftStorage ?? createBrowserDraftStorage();
  const primitives: PrimitivesRegistry = { ...defaultPrimitives, ...(options.primitives ?? {}) };
  const liveEvents = createEventSourceLiveEvents();

  // Feature-Plugins: providers stacken außen (jeder Gate + Screen sieht
  // jeden Provider), gates stacken zwischen Renderer-Providern und
  // Shell/Screen. Array-Order: erstes Element = äußerste Hülle.
  const clientFeatures = options.clientFeatures ?? [];
  const providers = clientFeatures.flatMap((f) => f.providers ?? []);
  const gates = clientFeatures.flatMap((f) => f.gates ?? []);
  // Precedence in fallbackBundles (Array-Order = Priorität, höchste zuerst):
  //   1. clientFeatures.translations — App-Overrides gewinnen immer, auch
  //      gegen framework-eigene Labels.
  //   2. schemaTranslations — server-authored r.translations, von
  //      buildAppSchema verbatim projiziert (#1059). Ohne dieses Bundle
  //      resolven Nav-/Screen-Labels nur, wenn eine App sie ZUSÄTZLICH in
  //      web/i18n.ts dupliziert — die meisten bundled-features taten das
  //      nie, Labels rendern dann als rohe i18n-Keys.
  //   3. kumikoDefaultTranslations — Framework-Defaults, ALLERLETZTER
  //      Fallback.
  const schemaTranslations = app.features.reduce<TranslationsByLocale>(
    (acc, f) =>
      f.translations ? mergeTranslations(acc, translationsByLocaleFromKeys(f.translations)) : acc,
    {},
  );
  const fallbackBundles = [
    ...clientFeatures.flatMap((f) => (f.translations !== undefined ? [f.translations] : [])),
    schemaTranslations,
    kumikoDefaultTranslations,
  ];
  // Custom-Screen-Components-Map mergen: spätere Features überschreiben
  // frühere bei screenId-Kollision (Last-Wins). Apps können so ein
  // bundled-Feature mit lokaler Override versehen.
  const customScreens: Record<string, ComponentType> = {};
  for (const f of clientFeatures) {
    if (f.components !== undefined) Object.assign(customScreens, f.components);
  }
  // Fail loud at boot instead of per-URL: a mounted server feature can
  // declare a `type: "custom"` screen that's reachable directly by URL
  // even without nav placement — without this check, a missing client
  // plugin only surfaces as an error placeholder to whoever happens to
  // open that URL (kumiko-framework#2025). Screens flagged `dormant`
  // (e.g. user-data-rights privacy-center, auth-mfa's enable screen) are
  // registered without a self-owned r.nav on purpose — an app opts in by
  // navving them explicitly, so a consumer that hasn't done that yet isn't
  // missing anything (kumiko-framework#2034). Still dev-only: several
  // bundled screens that ARE self-navved (e.g. compliance-profiles'
  // profile-picker) have real unmounted-client-plugin bugs in existing
  // consumer apps today (kumiko-framework#2025) — running this in
  // production before those are fixed (tracked via infra#503) would just
  // spam every affected app's console.
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    const missingCustomScreens = app.features.flatMap((f) =>
      f.screens
        .filter(
          (s) => s.type === "custom" && s.dormant !== true && customScreens[s.id] === undefined,
        )
        .map((s) => `${f.featureName}:${s.id}`),
    );
    if (missingCustomScreens.length > 0) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic for missing client plugins
      console.error(
        `[kumiko] ${missingCustomScreens.length} custom screen(s) have no registered component in clientFeatures.components — they render an error placeholder instead of the intended UI: ${missingCustomScreens.join(", ")}. Add the feature's web client plugin to clientFeatures.`,
      );
    }
  }
  // Column-renderer map, same last-wins semantics as customScreens —
  // duplicate keys across features are rarely intentional, so a
  // collision logs once instead of silently overriding a library's
  // renderer.
  const columnRenderers = mergeByKey(clientFeatures, (f) => f.columnRenderers, "columnRenderer");
  // Extension-section components — same last-wins + warn semantics as
  // columnRenderers. Mounted on ExtensionSectionsProvider; RenderEdit
  // resolves the component from the section's `__component` marker.
  const extensionSectionComponents = mergeByKey(
    clientFeatures,
    (f) => f.extensionSectionComponents,
    "extensionSectionComponent",
  );

  const contentEditors = mergeContentEditors(clientFeatures);

  const { navProviders, navEntities } = buildNavProviderMaps(
    clientFeatures,
    app.features.flatMap((f) => f.contentCollections ?? []),
  );

  // Aggregate editor resolvers — keyed by "featureId:action". Same
  // last-wins semantics as columnRenderers. Warns on collision.
  const resolvers = new Map<string, ResolverComponent>();
  for (const f of clientFeatures) {
    if (f.resolvers === undefined) continue;
    for (const [key, component] of Object.entries(f.resolvers)) {
      if (resolvers.has(key)) {
        // biome-ignore lint/suspicious/noConsole: client-bundle has no logger; collision is a dev-time warning that must surface in the browser DevTools.
        console.warn(
          `[kumiko] resolver "${key}" defined by multiple clientFeatures — last definition (from "${f.name}") wins.`,
        );
      }
      resolvers.set(key, component);
    }
  }

  const localeResolver = options.locale ?? createBrowserLocaleResolver();

  const navAdapter = options.navAdapter ?? useBrowserNavApi;
  const hasWorkspaces = (app.workspaces?.length ?? 0) > 0;
  const screenNode = (
    <BrowserNavBoot
      app={app}
      fallbackQn={fallbackQn}
      useNavApi={navAdapter}
      hasWorkspaces={hasWorkspaces}
      {...(options.translate !== undefined && { translate: options.translate })}
      {...(options.onRowClick !== undefined && { onRowClick: options.onRowClick })}
      {...(options.shell !== undefined && { shell: options.shell })}
    />
  );

  const tree = (
    <TokensBoot>
      <LocaleProvider resolver={localeResolver} fallbackBundles={fallbackBundles}>
        <DocumentLangSync resolver={localeResolver} />
        <PrimitivesProvider value={primitives}>
          <AppFeaturesProvider features={app.features}>
            <DispatcherProvider dispatcher={dispatcher}>
              <DraftStorageProvider value={draftStorage}>
                <LiveEventsProvider value={liveEvents}>
                  <DashboardBodyProvider value={WebDashboardBody}>
                    <CustomScreensProvider value={customScreens}>
                      <ColumnRenderersProvider value={columnRenderers}>
                        <ContentEditorsProvider value={contentEditors}>
                          <ExtensionSectionsProvider value={extensionSectionComponents}>
                            <NavProvidersProvider value={navProviders} entities={navEntities}>
                              <ResolversProvider resolvers={resolvers}>
                                <ToastProvider>
                                  <UpdateChecker />
                                  {stackWrappers(providers, stackWrappers(gates, screenNode))}
                                </ToastProvider>
                              </ResolversProvider>
                            </NavProvidersProvider>
                          </ExtensionSectionsProvider>
                        </ContentEditorsProvider>
                      </ColumnRenderersProvider>
                    </CustomScreensProvider>
                  </DashboardBodyProvider>
                </LiveEventsProvider>
              </DraftStorageProvider>
            </DispatcherProvider>
          </AppFeaturesProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensBoot>
  );

  const root = createRoot(container);
  root.render(tree);
  return { root };
}

// TokensBoot uses the browser-backed TokensApi hook (class-based
// dark-toggle) and passes the value through to the shared
// TokensProvider. No own state — the class on <html> is the
// SSoT, useSyncExternalStore in the hook syncs that into React.
function TokensBoot({ children }: { readonly children: ReactNode }): ReactNode {
  const api = useBrowserTokensApi();
  return <TokensProvider value={api}>{children}</TokensProvider>;
}

function BrowserNavBoot({
  app,
  fallbackQn,
  useNavApi,
  hasWorkspaces,
  translate,
  onRowClick,
  shell,
}: {
  readonly app: AppSchema;
  readonly fallbackQn: string;
  readonly useNavApi: (options?: {
    readonly hasWorkspaces?: boolean;
    readonly features?: readonly FeatureSchema[];
  }) => NavApi;
  readonly hasWorkspaces: boolean;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly shell?: (props: {
    readonly children: ReactNode;
    readonly schema: AppSchema;
  }) => ReactNode;
}): ReactNode {
  const navApi = useNavApi({ hasWorkspaces, features: app.features });
  const Shell = shell;
  const screen = (
    <RoutedScreen
      app={app}
      fallbackQn={fallbackQn}
      {...(translate !== undefined && { translate })}
      {...(onRowClick !== undefined && { onRowClick })}
    />
  );
  return (
    <NavProvider value={navApi}>
      {Shell !== undefined ? <Shell schema={app}>{screen}</Shell> : screen}
    </NavProvider>
  );
}

// Finds the feature that owns a fully qualified ScreenQn.
// Returns undefined if the screen isn't declared in any feature schema —
// KumikoScreen then renders the "Screen not found" banner.
function findOwnerFeature(app: AppSchema, qn: string): FeatureSchema | undefined {
  for (const feature of app.features) {
    for (const s of feature.screens) {
      if (qualifyScreenId(feature.featureName, s.id) === qn) return feature;
    }
  }
  return undefined;
}

function RoutedScreen({
  app,
  fallbackQn,
  translate,
  onRowClick,
}: {
  readonly app: AppSchema;
  readonly fallbackQn: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const nav = useNav();

  // ScreenId from the route is NOT qualified — nav.route.screenId
  // comes from the URL path and is the short form ("order-list"). We
  // need to pin it to the right feature. Strategy: iterate through all
  // features until the matching screen decl turns up. No match →
  // fallback feature (the one from fallbackQn).
  const { feature, qn, entityId } = useMemo(() => {
    if (nav.route === undefined) {
      return {
        feature: findOwnerFeature(app, fallbackQn),
        qn: fallbackQn,
        entityId: undefined as string | undefined,
      };
    }
    const shortId = nav.route.screenId;
    // Suche das Feature dessen Screens den short id enthalten.
    let matchedFeature: FeatureSchema | undefined;
    for (const f of app.features) {
      if (f.screens.some((s) => s.id === shortId)) {
        matchedFeature = f;
        break;
      }
    }
    const ownerFeature = matchedFeature ?? findOwnerFeature(app, fallbackQn);
    const qualifiedQn = ownerFeature ? qualifyScreenId(ownerFeature.featureName, shortId) : shortId;
    return {
      feature: ownerFeature,
      qn: qualifiedQn,
      entityId: nav.route.entityId,
    };
  }, [nav.route, app, fallbackQn]);

  const effectiveOnRowClick = useMemo<
    ((row: ListRowViewModel, entityName: string) => void) | undefined
  >(() => {
    return (row, entityName) => {
      // Precedence (fw#2164): detailFor screen, then onRowClick, then the
      // entityEdit-search fallback below. An explicit rowActions
      // rowClick:true already wins over all of this — kumiko-screen.tsx
      // handles it before onRowClick is ever called.
      if (hasDetailScreen(app.features, entityName)) {
        nav.navigate({ entity: entityName, id: row.id });
        return;
      }
      if (onRowClick !== undefined) {
        onRowClick(row, entityName);
        return;
      }
      // No declared detail screen and no app-wide onRowClick — search for
      // the edit screen for the entity across all features — in a
      // single-feature setup that's the same feature as the active one, in
      // multi-feature the edit could theoretically live in a different
      // feature (one that shares the entity).
      for (const f of app.features) {
        const editScreen = f.screens.find(
          (s) => s.type === "entityEdit" && s.entity === entityName,
        );
        if (editScreen) {
          // editScreen.id is already short form; lastSegment is a no-op
          // safety net here, kept for symmetry with the other call sites.
          nav.navigate({ screenId: lastSegment(editScreen.id), entityId: row.id });
          return;
        }
      }
    };
  }, [onRowClick, app.features, nav]);

  // Copy-link action (Issue #912) for entityEdit update screens. Builds
  // the absolute permalink URL from the current route + copies it —
  // `navigator`/`window` are allowed here (renderer-web, not a
  // platform-neutral package). No button without entityId (create-mode).
  // Silent-catch on clipboard error (non-secure context) mirrors the
  // existing pattern in pat-tokens-screen.tsx.
  const effectiveOnCopyLink = useMemo<(() => Promise<void> | void) | undefined>(() => {
    const route = nav.route;
    if (route?.entityId === undefined) return undefined;
    return async () => {
      const url = `${window.location.origin}${nav.hrefFor(route)}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard blocked (non-secure context) — no fallback UI needed here
      }
    };
  }, [nav]);

  // KumikoScreen will nach wie vor ein single-feature schema. Wir
  // füttern es mit dem owning Feature — es enthält Entity-Defs +
  // Screen-Defs für den aktiven Render-Pfad. Kein Owner gefunden → wir
  // nutzen das erste Feature als Fallback (KumikoScreen zeigt dann den
  // "Screen not found"-Banner für das nicht-existente qn).
  const schemaForScreen: FeatureSchema = feature ??
    app.features[0] ?? {
      featureName: "",
      entities: {},
      screens: [],
    };

  return (
    <KumikoScreen
      schema={schemaForScreen}
      qn={qn}
      {...(translate !== undefined && { translate })}
      {...(entityId !== undefined && { entityId })}
      onRowClick={effectiveOnRowClick}
      {...(effectiveOnCopyLink !== undefined && { onCopyLink: effectiveOnCopyLink })}
    />
  );
}
