// Test-Utilities für renderer-web-Tests. Wrappt `render()` mit den
// Providern die Consumer-Komponenten (RenderEdit, RenderList,
// KumikoScreen) zur Laufzeit erwarten: PrimitivesProvider mit den
// HTML-Defaults, NavProvider mit einem Stub (route=undefined), und
// LiveEventsProvider mit einem No-op-Subscriber.
//
// Dispatcher wird NICHT automatisch gestellt — Tests die einen
// brauchen, mounten DispatcherProvider selber (sonst landeten alle
// Tests mit dem gleichen Stub-Dispatcher, was echte Tests unsichtbar
// vor-defaultet). Für Nav brauchen die kumiko-screen-Tests nur dass
// `useNav()` nicht throwt; ein Stub reicht.
//
// Tests die ein anderes Setup brauchen (z.B. custom primitives, echte
// browser-Nav) bauen ihren Wrapper selbst — siehe nav.test.tsx.

import {
  type LiveEventSubscriber,
  LiveEventsProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@kumiko/renderer";
import { render as _render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { defaultPrimitives } from "../primitives";
import { defaultTokens } from "../tokens";

const stubNav: NavApi = {
  route: undefined,
  navigate: () => {},
  hrefFor: (target) =>
    target.entityId !== undefined
      ? `/${target.screenId}/${target.entityId}`
      : `/${target.screenId}`,
};

const stubLiveEvents: LiveEventSubscriber = () => () => {};

// Stub-Tokens-API für Tests. setTokens ist ein no-op — Tests die
// Toggle testen wollen, bauen sich ihren eigenen Wrapper.
const stubTokens = { tokens: defaultTokens, setTokens: () => {} };

function DefaultProviders({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <TokensProvider value={stubTokens}>
      <PrimitivesProvider value={defaultPrimitives}>
        <NavProvider value={stubNav}>
          <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
        </NavProvider>
      </PrimitivesProvider>
    </TokensProvider>
  );
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  return _render(ui, { wrapper: DefaultProviders, ...options });
}

export * from "@testing-library/react";
