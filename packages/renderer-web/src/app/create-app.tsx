import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
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
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  kumikoDefaultTranslations,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
  qualifyScreenId,
  TokensProvider,
  toAppSchema,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import { type ComponentType, type ReactNode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { lastSegment } from "../layout/nav-tree";
import { defaultPrimitives } from "../primitives";
import { ToastProvider } from "../primitives/toast";
import { createEventSourceLiveEvents } from "../sse/live-events";
import { useBrowserTokensApi } from "../tokens";
import { createBrowserLocaleResolver } from "./browser-locale";
import { type ClientFeatureDefinition, stackWrappers } from "./client-plugin";
import { useBrowserNavApi } from "./nav";

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

export function createKumikoApp(options: CreateKumikoAppOptions = {}): void {
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

  // Fallback-Screen: erstes Screen über alle Features in deklarierter
  // Reihenfolge. War vorher schema.screens[0], jetzt search the first
  // feature with screens.
  const firstFeatureWithScreens = app.features.find((f) => f.screens.length > 0);
  const firstScreen = firstFeatureWithScreens?.screens[0];
  const fallbackQn =
    options.screenQn ??
    (firstScreen !== undefined && firstFeatureWithScreens !== undefined
      ? qualifyScreenId(firstFeatureWithScreens.featureName, firstScreen.id)
      : undefined);
  if (!fallbackQn) {
    throw new Error(
      "createKumikoApp: schema contains no screens. Add at least one entry to `schema.screens` or pass `screenQn` explicitly.",
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
  // Framework-Default-Bundle als ALLERLETZTER Fallback — App-Resolver +
  // clientFeatures.translations haben Vorrang. Apps können einzelne
  // kumiko.*-Keys via clientFeatures.translations überschreiben (z.B.
  // "kumiko.actions.save" → "Sichern" für ein bestimmtes Feature).
  const fallbackBundles = [
    ...clientFeatures.flatMap((f) => (f.translations !== undefined ? [f.translations] : [])),
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

  const resolver = options.locale ?? createBrowserLocaleResolver();

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
      <LocaleProvider resolver={resolver} fallbackBundles={fallbackBundles}>
        <PrimitivesProvider value={primitives}>
          <DispatcherProvider dispatcher={dispatcher}>
            <LiveEventsProvider value={liveEvents}>
              <CustomScreensProvider value={customScreens}>
                <ColumnRenderersProvider value={columnRenderers}>
                  <ToastProvider>
                    {stackWrappers(providers, stackWrappers(gates, screenNode))}
                  </ToastProvider>
                </ColumnRenderersProvider>
              </CustomScreensProvider>
            </LiveEventsProvider>
          </DispatcherProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensBoot>
  );

  createRoot(container).render(tree);
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
    />
  );
}
