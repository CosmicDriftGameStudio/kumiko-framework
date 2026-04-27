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
  createStore,
  type Dispatcher,
  type DispatcherStatus,
  type WritableStore,
} from "@kumiko/headless";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@kumiko/renderer";
import { render as _render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { defaultPrimitives } from "../primitives";
import { defaultTokens } from "../tokens";

// jsdom hat keinen ResizeObserver — cmdk (Combobox-Library) braucht
// das im Setup. Stub reicht für unsere Tests; wir messen keine
// Sizes, nur Mount-Lifecycle. Setze als globaler Side-Effect beim
// Modul-Import damit alle Tests die test-utils laden ihn haben.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const stubNav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: (target) =>
    target.entityId !== undefined
      ? `/${target.screenId}/${target.entityId}`
      : `/${target.screenId}`,
  searchParams: {},
  setSearchParams: () => {},
};

const stubLiveEvents: LiveEventSubscriber = () => () => {};

// Stub-Tokens-API für Tests. Mode-Setter ist ein no-op — Tests die
// Theme-Toggle testen wollen, bauen sich ihren eigenen Wrapper.
const stubTokens = {
  tokens: defaultTokens,
  mode: "dark" as const,
  setMode: () => {},
  toggleMode: () => {},
};

const stubResolver = createStaticLocaleResolver();

function DefaultProviders({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <TokensProvider value={stubTokens}>
      <LocaleProvider resolver={stubResolver} fallbackBundles={[kumikoDefaultTranslations]}>
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={stubNav}>
            <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  return _render(ui, { wrapper: DefaultProviders, ...options });
}

// ---------------------------------------------------------------------------
// Mock-Dispatcher-Helper
// ---------------------------------------------------------------------------

export type MockDispatcherOptions = {
  /** Initialer Status. Default: "online". Tests die Transitions prüfen,
   *  greifen den zurückgegebenen `statusStore` ab und mutieren ihn via
   *  `statusStore.setState(...)`. */
  readonly initialStatus?: DispatcherStatus;
  /** Override write(). Default: returnt `{ isSuccess: true, data: {} }`. */
  readonly write?: Dispatcher["write"];
  /** Override query(). Default: returnt `{ isSuccess: true, data: {} }`. */
  readonly query?: Dispatcher["query"];
  /** Override batch(). Default: returnt `{ isSuccess: true, results: [] }`. */
  readonly batch?: Dispatcher["batch"];
};

/** Minimal Mock-Dispatcher für renderer-web-Tests. Replaces the
 *  hand-rolled `makeDispatcher()` Funktionen, die in fast jedem
 *  Test-File identisch waren. Der zurückgegebene `statusStore` ist
 *  ein WritableStore, damit Tests Status-Wechsel auslösen können —
 *  beim public Dispatcher-Contract ist statusStore read-only, aber
 *  Mocks dürfen mehr.
 *
 *  Pending queues sind immer `[]` (live-dispatcher-Semantik); Tests
 *  die savable-Pending-Verhalten prüfen wollen, mocken den Dispatcher
 *  selbst.
 */
export function createMockDispatcher(options: MockDispatcherOptions = {}): Dispatcher & {
  /** Schreibbarer Zugriff auf den Status-Store für Test-Mutationen.
   *  Identisch zu `dispatcher.statusStore` (Aliasing), aber als
   *  WritableStore typisiert. */
  readonly statusStore: WritableStore<DispatcherStatus>;
} {
  const statusStore = createStore<DispatcherStatus>(options.initialStatus ?? "online");
  return {
    write:
      options.write ??
      ((async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"]),
    query:
      options.query ??
      ((async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"]),
    batch:
      options.batch ??
      ((async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"]),
    statusStore,
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

export * from "@testing-library/react";
