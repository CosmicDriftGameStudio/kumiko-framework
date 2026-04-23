import { createLiveDispatcher } from "@kumiko/dispatcher-live";
import type { Dispatcher, ListRowViewModel, Translate } from "@kumiko/headless";
import {
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  LiveEventsProvider,
  NavProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
  qualifyScreenId,
  useNav,
} from "@kumiko/renderer";
import { type ReactNode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { defaultPrimitives } from "../primitives";
import { createEventSourceLiveEvents } from "../sse/live-events";
import { useBrowserNavApi } from "./nav";

// Web-Bootstrap. Mounted den ganzen Kumiko-Render-Stack im Browser:
// PrimitivesProvider mit HTML-Defaults, NavProvider mit window.history-
// Backing, LiveEventsProvider mit EventSource, DispatcherProvider mit
// createLiveDispatcher. URL ist Source-of-Truth für den aktuellen
// Screen.
//
// Typical client.ts:
//
//   createKumikoApp({ schema: clientSchema });
//
// Keine zweite Zeile nötig für 95% der Apps.

export type CreateKumikoAppOptions = {
  readonly schema: FeatureSchema;
  /** DOM element id to mount into. Default "root". */
  readonly rootId?: string;
  /** Dispatcher override — tests pass a fake; real apps let the
   *  default `createLiveDispatcher()` talk to the same-origin API. */
  readonly dispatcher?: Dispatcher;
  /** Fallback screen when the URL is `/` (no route). Pass a qualified
   *  qn; defaults to the first entry in `schema.screens`. */
  readonly screenQn?: string;
  /** i18n callback forwarded to the screens. Default identity. */
  readonly translate?: Translate;
  /** Row-click handler for entityList screens. */
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  /** Optional wrapping component — receives the Kumiko screen as
   *  `children` and renders around it. Runs inside all Providers. */
  readonly shell?: (props: { readonly children: ReactNode }) => ReactNode;
  /** Partial override für die Primitives-Registry. Pass only the
   *  components you want to swap; unspecified primitives fall
   *  through to the HTML defaults. */
  readonly primitives?: Partial<PrimitivesRegistry>;
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
  // Merge partial primitives-override with HTML defaults once at
  // bootstrap — stable registry avoids re-render storms from a fresh
  // object identity per render.
  const primitives: PrimitivesRegistry = { ...defaultPrimitives, ...(options.primitives ?? {}) };
  // EventSource-subscriber lebt im Closure dieser Factory — App-
  // lifetime scoped, re-mounting bekommt eine frische Verbindung.
  const liveEvents = createEventSourceLiveEvents();

  createRoot(container).render(
    <PrimitivesProvider value={primitives}>
      <DispatcherProvider dispatcher={dispatcher}>
        <LiveEventsProvider value={liveEvents}>
          <BrowserNavBoot
            schema={options.schema}
            fallbackQn={fallbackQn}
            {...(options.translate !== undefined && { translate: options.translate })}
            {...(options.onRowClick !== undefined && { onRowClick: options.onRowClick })}
            {...(options.shell !== undefined && { shell: options.shell })}
          />
        </LiveEventsProvider>
      </DispatcherProvider>
    </PrimitivesProvider>,
  );
}

// Separates Component-Layer damit useBrowserNavApi (ruft
// useSyncExternalStore) korrekt innerhalb eines React-Trees läuft.
// Musste vor RoutedScreen stehen weil RoutedScreen useNav() aufruft —
// das braucht einen bereits verdrahteten NavProvider.
function BrowserNavBoot({
  schema,
  fallbackQn,
  translate,
  onRowClick,
  shell,
}: {
  readonly schema: FeatureSchema;
  readonly fallbackQn: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly shell?: (props: { readonly children: ReactNode }) => ReactNode;
}): ReactNode {
  const navApi = useBrowserNavApi();
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

// Liest die aktuelle Route aus useNav und mapt sie auf KumikoScreen-
// Props. Sitzt innerhalb NavProvider, re-rendert bei jeder Navigation.
// Default-onRowClick (click row → edit) lebt hier: findet den ersten
// entityEdit-Screen für die Entity der Row und navigiert dahin.
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
