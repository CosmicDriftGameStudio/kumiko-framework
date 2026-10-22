//
// Shared test setup for the Web UI components. Mounts the minimum
// provider tree required by the components at runtime
// (LocaleProvider with a bundle, SessionContext with an injectable value).

import { mock } from "bun:test";
import {
  BasePathProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher, LocaleResolver } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { render as _render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { defaultTranslations } from "../i18n.ts";
import type { SessionApi, SessionState } from "../session.tsx";
import { SessionContext } from "../session.tsx";

// Stateless resolver — cached at module scope because renderWithProviders
// would otherwise construct it for every mount (~0.5ms × N tests). Tests that
// need a *different* locale pass their own resolver through options.resolver.
const sharedEnResolver = createStaticLocaleResolver({ locale: "en" });
export type MakeSessionApiOptions = Partial<SessionState> & {
  readonly login?: SessionApi["login"];
  readonly logout?: SessionApi["logout"];
  readonly switchTenant?: SessionApi["switchTenant"];
  readonly refresh?: SessionApi["refresh"];
};
export function makeSessionApi(overrides: MakeSessionApiOptions = {}): SessionApi {
  const { login, logout, switchTenant, refresh, ...stateOverrides } = overrides;
  const base: SessionState = {
    status: "authenticated",
    user: {
      id: "test-user",
      email: "user@example.com",
      displayName: "Test User",
      globalRoles: [],
    },
    activeTenantId: "tenant-1",
    tenants: [{ tenantId: "tenant-1", roles: ["Admin"] }],
    roles: ["Admin"],
    bootstrapFailure: null,
    signedOutReason: null,
    ...stateOverrides,
  };
  return {
    ...base,
    login:
      login ??
      mock<SessionApi["login"]>(async () => ({
        kind: "success",
        data: {
          token: "test-token",
          user: { id: "test-user", tenantId: "tenant-1", roles: ["Admin"] },
        },
      })),
    logout: logout ?? mock<SessionApi["logout"]>(async () => {}),
    switchTenant: switchTenant ?? mock<SessionApi["switchTenant"]>(async () => {}),
    refresh: refresh ?? mock<SessionApi["refresh"]>(async () => {}),
  };
}
export function renderWithProviders(
  ui: ReactElement,
  options: {
    readonly resolver?: LocaleResolver;
    readonly session?: SessionApi;
    readonly dispatcher?: Dispatcher;
    readonly basePath?: string;
  } = {},
): RenderResult & { readonly session: SessionApi } {
  const resolver = options.resolver ?? sharedEnResolver;
  const session = options.session ?? makeSessionApi();
  const sessionTree = <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>;
  const tree = <BasePathProvider basePath={options.basePath}>{sessionTree}</BasePathProvider>;
  const result = _render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
        {options.dispatcher ? (
          <DispatcherProvider dispatcher={options.dispatcher}>{tree}</DispatcherProvider>
        ) : (
          tree
        )}
      </LocaleProvider>
    </PrimitivesProvider>,
  );
  return { ...result, session };
}
