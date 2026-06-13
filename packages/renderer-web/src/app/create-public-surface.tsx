import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { Dispatcher, LocaleResolver } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
  type PrimitivesRegistry,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultPrimitives } from "../primitives";
import { ToastProvider } from "../primitives/toast";
import { createBrowserLocaleResolver } from "./browser-locale";
import { type ClientFeatureDefinition, stackWrappers } from "./client-plugin";

// Apex-Surface — der öffentliche Gegenpart zu createKumikoApp. Mountet eine
// schlanke, schema-LOSE Provider-Chain (Locale + Primitives + Dispatcher +
// feature-providers) und rendert genau einen anhand des URL-Pfads gewählten
// Content. Bewusst KEIN Schema, KEINE Nav, KEIN KumikoScreen: die Surface ist
// anonym erreichbar, ein __KUMIKO_SCHEMA__-Inject würde Admin-Nav/Topologie an
// Besucher leaken (injectSchema:false ist hier struktureller Default, kein Flag).
//
// `routes` sind app-authored React-Elemente — Auth-Screens et al. tragen
// Callback-Props (loggedInHref usw.), die durch keine serialisierbare
// ScreenDefinition passen würden; deshalb laufen sie über diesen Mount und
// nicht über die Registry. Späterer Registry-Content (CMS/Landing) konvergiert
// auf denselben Mount.
//
//   createPublicSurface({
//     routes: [{ path: "/login", component: <LoginScreen ... /> }],
//     fallback: <LoginScreen ... />,
//     clientFeatures: [emailPasswordClient()],
//     shell: ({ children }) => <MarketingChrome>{children}</MarketingChrome>,
//   });

export type PublicRoute = {
  /** Exakter window.location.pathname-Match (match-once beim Mount; alle
   *  Apex-Pages sind Full-Page-Reloads, kein SPA-Router). */
  readonly path: string;
  readonly component: ReactNode;
};

export type CreatePublicSurfaceOptions = {
  readonly routes: readonly PublicRoute[];
  /** Gerendert wenn kein route.path auf den aktuellen Pfad matcht. */
  readonly fallback?: ReactNode;
  readonly rootId?: string;
  readonly locale?: LocaleResolver;
  readonly primitives?: Partial<PrimitivesRegistry>;
  /** Dispatcher für Handler-Calls (z.B. anonymer Deletion-Request). Auth-
   *  Screens brauchen ihn nicht (fetch via auth-client), aber er steht für
   *  dispatchende Public-Flows bereit. Default: createLiveDispatcher(). */
  readonly dispatcher?: Dispatcher;
  /** Feature-Client-Extensions — NUR `providers` + `translations` werden
   *  gestackt. `gates` werden bewusst ignoriert: ein AuthGate würde die
   *  öffentliche Surface hinter Login sperren. */
  readonly clientFeatures?: readonly ClientFeatureDefinition[];
  /** Page-Chrome um den gematchten Content (Apex-/Marketing-Layout). */
  readonly shell?: (props: { readonly children: ReactNode }) => ReactNode;
};

function matchRoute(options: CreatePublicSurfaceOptions, pathname: string): ReactNode {
  for (const route of options.routes) {
    if (route.path === pathname) return route.component;
  }
  return options.fallback ?? null;
}

export function createPublicSurface(options: CreatePublicSurfaceOptions): { readonly root: Root } {
  const rootId = options.rootId ?? "root";
  const container = document.getElementById(rootId);
  if (!container) {
    throw new Error(
      `createPublicSurface: DOM element #${rootId} not found. Make sure your HTML has a matching <div id="${rootId}"></div> before the bundle loads.`,
    );
  }

  const dispatcher = options.dispatcher ?? createLiveDispatcher();
  const primitives: PrimitivesRegistry = { ...defaultPrimitives, ...(options.primitives ?? {}) };
  const localeResolver = options.locale ?? createBrowserLocaleResolver();

  const clientFeatures = options.clientFeatures ?? [];
  const providers = clientFeatures.flatMap((f) => f.providers ?? []);
  const fallbackBundles = [
    ...clientFeatures.flatMap((f) => (f.translations !== undefined ? [f.translations] : [])),
    kumikoDefaultTranslations,
  ];

  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const matched = matchRoute(options, pathname);
  const Shell = options.shell;
  const content = Shell !== undefined ? <Shell>{matched}</Shell> : matched;

  const tree = (
    <LocaleProvider resolver={localeResolver} fallbackBundles={fallbackBundles}>
      <PrimitivesProvider value={primitives}>
        <DispatcherProvider dispatcher={dispatcher}>
          <ToastProvider>{stackWrappers(providers, content)}</ToastProvider>
        </DispatcherProvider>
      </PrimitivesProvider>
    </LocaleProvider>
  );

  const root = createRoot(container);
  root.render(tree);
  return { root };
}
