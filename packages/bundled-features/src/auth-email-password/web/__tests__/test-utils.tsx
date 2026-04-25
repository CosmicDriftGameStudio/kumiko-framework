// @vitest-environment jsdom
//
// Shared test setup für die Web-UI-Components. Mountet das Minimum
// an Provider-Tree den die Components zur Laufzeit voraussetzen
// (LocaleProvider mit Bundle, SessionContext mit injizierbarem Wert).

import type { LocaleResolver } from "@kumiko/headless";
import { createStaticLocaleResolver, LocaleProvider } from "@kumiko/renderer";
import { render as _render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import type { SessionApi, SessionState } from "../session";
import { SessionContext } from "../session";
import { defaultTranslations } from "../translations";

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
    },
    activeTenantId: "tenant-1",
    tenants: [{ tenantId: "tenant-1", roles: ["Admin"] }],
    ...stateOverrides,
  };
  return {
    ...base,
    login: login ?? (vi.fn(async () => ({ ok: true })) as SessionApi["login"]),
    logout: logout ?? vi.fn(async () => {}),
    switchTenant: switchTenant ?? vi.fn(async () => {}),
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: {
    readonly resolver?: LocaleResolver;
    readonly session?: SessionApi;
  } = {},
): RenderResult & { readonly session: SessionApi } {
  const resolver = options.resolver ?? createStaticLocaleResolver({ locale: "de" });
  const session = options.session ?? makeSessionApi();
  const result = _render(
    <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
      <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>
    </LocaleProvider>,
  );
  return { ...result, session };
}
