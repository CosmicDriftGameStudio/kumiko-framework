import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import type {
  Dispatcher,
  ListRowViewModel,
  LocaleResolver,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import {
  type AppSchema,
  type ColumnRendererComponent,
  ColumnRenderersProvider,
  CustomScreensProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  type ExtensionSectionComponent,
  ExtensionSectionsProvider,
  type FeatureSchema,
  KumikoScreen,
  kumikoDefaultTranslations,
  LiveEventsProvider,
  LocaleProvider,
  mergeTranslations,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
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
  readonly screenQn?: string;
  readonly translate?: Translate;
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
   *  Router das anders löst. */
  readonly navAdapter?: (options?: { readonly hasWorkspaces?: boolean }) => NavApi;
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
  // Column-Renderer-Map mergen — gleiche Last-Wins-Semantik wie bei
  // customScreens. Doppelte Keys über Features sind selten gewollt;
  // wir warnen einmalig pro Kollision damit das nicht stillschweigend
  // den Renderer einer Library überschreibt.
  const columnRenderers: Record<string, ColumnRendererComponent> = {};
  for (const f of clientFeatures) {
    if (f.columnRenderers === undefined) continue;
    for (const [key, value] of Object.entries(f.columnRenderers)) {
      if (columnRenderers[key] !== undefined) {
        // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
        console.warn(
          `[kumiko] columnRenderer "${key}" defined by multiple clientFeatures — last definition (from "${f.name}") wins.`,
        );
      }
      columnRenderers[key] = value;
    }
  }
  // Extension-Section-Components — same Last-Wins + Warn-Semantik wie
  // columnRenderers. Mountet sich am ExtensionSectionsProvider; RenderEdit
  // löst die Component aus dem `__component`-Marker der section.
  const extensionSectionComponents: Record<string, ExtensionSectionComponent> = {};
  for (const f of clientFeatures) {
    if (f.extensionSectionComponents === undefined) continue;
    for (const [key, value] of Object.entries(f.extensionSectionComponents)) {
      if (extensionSectionComponents[key] !== undefined) {
        // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
        console.warn(
          `[kumiko] extensionSectionComponent "${key}" defined by multiple clientFeatures — last definition (from "${f.name}") wins.`,
        );
      }
      extensionSectionComponents[key] = value;
    }
  }

  // Nav-Provider-Map: ein navProvider hängt dynamische Children an einen
  // konkreten r.nav({provider:true})-Knoten (per QN). Lokale nav-ids werden
  // wie in r.nav mit dem Feature-Namen qualifiziert; bereits qualifizierte
  // QNs (cross-feature, z.B. App registriert Nav für ein bundled-feature)
  // gehen unverändert durch.
  const navProviders = new Map<string, TreeChildrenSubscribe>();
  const navEntities = new Map<string, readonly string[]>();
  for (const f of clientFeatures) {
    for (const [navId, provider] of Object.entries(f.navProviders ?? {})) {
      const qn = qualifyNavProviderKey(f.name, navId);
      if (navProviders.has(qn)) {
        // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
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

  // Editor-Resolver aggregieren — keyed by "featureId:action". Gleiche
  // Last-Wins-Semantik wie columnRenderers. Warnung bei Kollision.
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
        <PrimitivesProvider value={primitives}>
          <DispatcherProvider dispatcher={dispatcher}>
            <LiveEventsProvider value={liveEvents}>
              <DashboardBodyProvider value={WebDashboardBody}>
                <CustomScreensProvider value={customScreens}>
                  <ColumnRenderersProvider value={columnRenderers}>
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
                  </ColumnRenderersProvider>
                </CustomScreensProvider>
              </DashboardBodyProvider>
            </LiveEventsProvider>
          </DispatcherProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensBoot>
  );

  const root = createRoot(container);
  root.render(tree);
  return { root };
}

// TokensBoot nutzt den browser-backed TokensApi-Hook (class-based
// dark-toggle) und reicht den Wert an den shared TokensProvider
// durch. Keine eigene State-Haltung — die class auf <html> ist die
// SSoT, useSyncExternalStore im Hook synced das in React.
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
  readonly useNavApi: (options?: { readonly hasWorkspaces?: boolean }) => NavApi;
  readonly hasWorkspaces: boolean;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly shell?: (props: {
    readonly children: ReactNode;
    readonly schema: AppSchema;
  }) => ReactNode;
}): ReactNode {
  const navApi = useNavApi({ hasWorkspaces });
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

// Sucht das Feature, dem ein vollständig qualifizierter ScreenQn gehört.
// Returns undefined wenn der Screen in keinem Feature-Schema deklariert
// ist — KumikoScreen rendert dann den "Screen not found"-Banner.
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

  // ScreenId aus dem Route ist NICHT qualified — nav.route.screenId
  // kommt aus dem URL-Path und ist die kurze Form ("order-list"). Wir
  // müssen das ans richtige Feature heften. Strategie: durch alle
  // Features iterieren bis das passende Screen-Decl auftaucht. Ohne
  // Match → Fallback-Feature (das vom fallbackQn).
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
    if (onRowClick !== undefined) return onRowClick;
    return (row, entityName) => {
      // Edit-Screen für die Entity über alle Features suchen — im
      // Single-Feature-Setup ist das das gleiche Feature wie das aktive,
      // im Multi-Feature kann der Edit theoretisch in einem anderen
      // Feature liegen (eines, das die Entity teilt).
      for (const f of app.features) {
        const editScreen = f.screens.find(
          (s) => s.type === "entityEdit" && s.entity === entityName,
        );
        if (editScreen) {
          // editScreen.id ist QN-Form (registry-stamped); nav.navigate
          // erwartet Short-Form. Sonst wird die URL doppelt-qualifiziert.
          nav.navigate({ screenId: lastSegment(editScreen.id), entityId: row.id });
          return;
        }
      }
    };
  }, [onRowClick, app.features, nav]);

  // Copy-Link-Action (Issue #912) für entityEdit-Update-Screens. Baut die
  // absolute Permalink-URL aus der aktuellen Route + kopiert sie —
  // `navigator`/`window` sind hier erlaubt (renderer-web, kein
  // platform-neutrales Package). Kein Button ohne entityId (create-mode).
  // Silent-catch bei Clipboard-Fehler (non-secure context) mirrort das
  // bestehende Muster in pat-tokens-screen.tsx.
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
