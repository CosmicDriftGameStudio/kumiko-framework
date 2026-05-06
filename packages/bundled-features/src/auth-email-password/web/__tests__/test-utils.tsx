// @vitest-environment jsdom
//
// Shared test setup für die Web-UI-Components. Mountet das Minimum
// an Provider-Tree den die Components zur Laufzeit voraussetzen
// (LocaleProvider mit Bundle, SessionContext mit injizierbarem Wert).

import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render as _render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { defaultTranslations } from "../../i18n";
import type { SessionApi, SessionState } from "../session";
import { SessionContext } from "../session";

// Stateless Resolver — module-level cached, weil renderWithProviders
// ihn pro Mount sonst neu konstruiert (~0.5ms × N Tests). Tests die
// einen *anderen* Locale brauchen, übergeben ihren eigenen Resolver
// über options.resolver.
const sharedDeResolver = createStaticLocaleResolver({ locale: "de" });

export type MakeSessionApiOptions = Partial<SessionState> & {
  readonly login?: SessionApi["login"];
  readonly logout?: SessionApi["logout"];
  readonly switchTenant?: SessionApi["switchTenant"];
};

export function makeSessionApi(overrides: MakeSessionApiOptions = {}): SessionApi {
  const { login, logout, switchTenant, ...stateOverrides } = overrides;
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
    ...stateOverrides,
  };
  return {
    ...base,
    login: login ?? vi.fn<SessionApi["login"]>(async () => ({ ok: true })),
    logout: logout ?? vi.fn<SessionApi["logout"]>(async () => {}),
    switchTenant: switchTenant ?? vi.fn<SessionApi["switchTenant"]>(async () => {}),
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: {
    readonly resolver?: LocaleResolver;
    readonly session?: SessionApi;
  } = {},
): RenderResult & { readonly session: SessionApi } {
  const resolver = options.resolver ?? sharedDeResolver;
  const session = options.session ?? makeSessionApi();
  const result = _render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
        <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
  return { ...result, session };
}
