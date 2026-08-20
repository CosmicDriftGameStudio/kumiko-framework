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
import { DocumentLangSync } from "./document-lang-sync";

// Apex surface — the public counterpart to createKumikoApp. Mounts a thin,
// schema-LESS provider chain (locale + primitives + dispatcher +
// feature-providers) and renders exactly one content chosen by URL path.
// Deliberately NO schema, NO nav, NO KumikoScreen: the surface is reachable
// anonymously, and a __KUMIKO_SCHEMA__ inject would leak admin nav/topology
// to visitors (injectSchema:false is a structural default here, not a flag).
//
// `routes` are app-authored React elements — auth screens et al. carry
// callback props (loggedInHref etc.) that wouldn't fit through any
// serializable ScreenDefinition; that's why they run through this mount and
// not through the registry. Later registry content (CMS/landing) converges
// on the same mount.
//
//   createPublicSurface({
//     routes: [{ path: "/login", component: <LoginScreen ... /> }],
//     fallback: <LoginScreen ... />,
//     clientFeatures: [emailPasswordClient()],
//     shell: ({ children }) => <MarketingChrome>{children}</MarketingChrome>,
//   });

export type PublicRoute = {
  /** Exact window.location.pathname match (matched once on mount; every
   *  apex page is a full-page reload, no SPA router). */
  readonly path: string;
  readonly component: ReactNode;
};

export type CreatePublicSurfaceOptions = {
  readonly routes: readonly PublicRoute[];
  /** Rendered when no route.path matches the current path. */
  readonly fallback?: ReactNode;
  readonly rootId?: string;
  readonly locale?: LocaleResolver;
  readonly primitives?: Partial<PrimitivesRegistry>;
  /** Dispatcher for handler calls (e.g. an anonymous deletion request).
   *  Auth screens don't need it (fetch via auth-client), but it's there for
   *  dispatching public flows. Default: createLiveDispatcher(). */
  readonly dispatcher?: Dispatcher;
  /** Feature client extensions — ONLY `providers` + `translations` are
   *  stacked. `gates` are deliberately ignored: an AuthGate would lock the
   *  public surface behind login. */
  readonly clientFeatures?: readonly ClientFeatureDefinition[];
  /** Page chrome around the matched content (apex/marketing layout). */
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
      <DocumentLangSync resolver={localeResolver} />
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
