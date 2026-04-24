import { createLiveDispatcher } from "@kumiko/dispatcher-live";
import type { Dispatcher, ListRowViewModel, LocaleResolver, Translate } from "@kumiko/headless";
import {
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
  qualifyScreenId,
  TokensProvider,
  useNav,
} from "@kumiko/renderer";
import { type ReactNode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { defaultPrimitives } from "../primitives";
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
  readonly schema: FeatureSchema;
  readonly rootId?: string;
  readonly dispatcher?: Dispatcher;
  readonly screenQn?: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly shell?: (props: { readonly children: ReactNode }) => ReactNode;
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
   *  ist das gängige Pattern. */
  readonly navAdapter?: () => NavApi;
};

export function createKumikoApp(options: CreateKumikoAppOptions): void {
  const rootId = options.rootId ?? "root";
  const container = document.getElementById(rootId);
  if (!container) {
    throw new Error(
      `createKumikoApp: DOM element #${rootId} not found. Make sure your HTML has a matching <div id="${rootId}"></div> before the bundle loads.`,
    );
  }

  const [firstScreen] = options.schema.screens;
  const fallbackQn =
    options.screenQn ??
    (firstScreen !== undefined
      ? qualifyScreenId(options.schema.featureName, firstScreen.id)
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
  const fallbackBundles = clientFeatures.flatMap((f) =>
    f.translations !== undefined ? [f.translations] : [],
  );

  const resolver = options.locale ?? createBrowserLocaleResolver();

  const navAdapter = options.navAdapter ?? useBrowserNavApi;
  const screenNode = (
    <BrowserNavBoot
      schema={options.schema}
      fallbackQn={fallbackQn}
      useNavApi={navAdapter}
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
              {stackWrappers(providers, stackWrappers(gates, screenNode))}
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
  schema,
  fallbackQn,
  useNavApi,
  translate,
  onRowClick,
  shell,
}: {
  readonly schema: FeatureSchema;
  readonly fallbackQn: string;
  readonly useNavApi: () => NavApi;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly shell?: (props: { readonly children: ReactNode }) => ReactNode;
}): ReactNode {
  const navApi = useNavApi();
  const Shell = shell;
  const screen = (
    <RoutedScreen
      schema={schema}
      fallbackQn={fallbackQn}
      {...(translate !== undefined && { translate })}
      {...(onRowClick !== undefined && { onRowClick })}
    />
  );
  return (
    <NavProvider value={navApi}>
      {Shell !== undefined ? <Shell>{screen}</Shell> : screen}
    </NavProvider>
  );
}

function RoutedScreen({
  schema,
  fallbackQn,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly fallbackQn: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const nav = useNav();
  const { qn, entityId } = useMemo(() => {
    if (nav.route === undefined) return { qn: fallbackQn, entityId: undefined };
    return {
      qn: qualifyScreenId(schema.featureName, nav.route.screenId),
      entityId: nav.route.entityId,
    };
  }, [nav.route, fallbackQn, schema.featureName]);

  const effectiveOnRowClick = useMemo<
    ((row: ListRowViewModel, entityName: string) => void) | undefined
  >(() => {
    if (onRowClick !== undefined) return onRowClick;
    return (row, entityName) => {
      const editScreen = schema.screens.find(
        (s) => s.type === "entityEdit" && s.entity === entityName,
      );
      if (!editScreen) return;
      nav.navigate({ screenId: editScreen.id, entityId: row.id });
    };
  }, [onRowClick, schema.screens, nav]);

  return (
    <KumikoScreen
      schema={schema}
      qn={qn}
      {...(translate !== undefined && { translate })}
      {...(entityId !== undefined && { entityId })}
      onRowClick={effectiveOnRowClick}
    />
  );
}
