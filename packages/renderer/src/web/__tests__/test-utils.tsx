// Test utilities for renderer-web tests. Wraps `render()` with the
// providers that consumer components (RenderEdit, RenderList,
// KumikoScreen) expect at runtime: PrimitivesProvider with the HTML
// defaults, NavProvider with a stub (route=undefined), and
// LiveEventsProvider with a no-op subscriber.
//
// DispatcherProvider is intentionally not included: tests that need one
// mount it themselves, preventing every test from silently using the same
// stub dispatcher. The kumiko-screen tests only need `useNav()` not to
// throw, so a stub is sufficient.
//
// Tests requiring a different setup (for example, custom primitives or real
// browser navigation) build their own wrapper; see nav.test.tsx.

import { afterEach, beforeEach } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render as _render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  createStore,
  type Dispatcher,
  type DispatcherStatus,
  type WritableStore,
} from "../../headless/index.ts";
import {
  createStaticLocaleResolver,
  type DraftStorage,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
} from "../../index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";
import { defaultTokens } from "../tokens.ts";
import { SidebarProvider } from "../ui/sidebar.tsx";

// jsdom has no ResizeObserver, which cmdk (the Combobox library) requires
// during setup. The stub is sufficient because these tests do not measure
// sizes, only mount lifecycles. Install it as a global side effect on module
// import so every test loading test-utils has it.
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
  hrefFor: (target) => {
    if (!("screenId" in target)) return "";
    return target.entityId !== undefined
      ? `/${target.screenId}/${target.entityId}`
      : `/${target.screenId}`;
  },
  searchParams: {},
  setSearchParams: () => {},
};

const stubLiveEvents: LiveEventSubscriber = () => () => {};

// Stub token API for tests. The mode setters are no-ops; tests that exercise
// the theme toggle create their own wrapper.
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

// DefaultProviders + SidebarProvider. Used only for isolated tests of
// vendored shadcn Sidebar components (NavTree → SidebarMenuButton calls
// useSidebar()). It is not the default because SidebarProvider adds
// TooltipProvider and keydown/matchMedia listeners; wrapping everything
// globally slows down and leaks across single-CPU CI (Banner timeouts).
// Shells provide their own provider.
function SidebarProviders({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <DefaultProviders>
      <SidebarProvider>{children}</SidebarProvider>
    </DefaultProviders>
  );
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  return _render(ui, { wrapper: DefaultProviders, ...options });
}

export function renderWithSidebar(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return _render(ui, { wrapper: SidebarProviders, ...options });
}

// Nested PrimitivesProvider overrides the outer DefaultProviders one for
// this subtree — for tests exercising a fallback when a primitive isn't
// registered (e.g. StepBar undefined on an older PrimitivesRegistry).
export function renderWithPrimitivesOverride(
  ui: ReactElement,
  primitivesOverride: Partial<typeof defaultPrimitives>,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <DefaultProviders>
        <PrimitivesProvider value={{ ...defaultPrimitives, ...primitivesOverride }}>
          {children}
        </PrimitivesProvider>
      </DefaultProviders>
    );
  }
  return _render(ui, { wrapper: Wrapper, ...options });
}

// ---------------------------------------------------------------------------
// Mock-Dispatcher-Helper
// ---------------------------------------------------------------------------

export type MockDispatcherOptions = {
  /** Initial status. Default: "online". Tests that check transitions can
   * access the returned `statusStore` and mutate it via
   * `statusStore.setState(...)`. */
  readonly initialStatus?: DispatcherStatus;
  /** Override write(). Default: returnt `{ isSuccess: true, data: {} }`. */
  readonly write?: Dispatcher["write"];
  /** Override query(). Default: returnt `{ isSuccess: true, data: {} }`. */
  readonly query?: Dispatcher["query"];
  /** Override batch(). Default: returnt `{ isSuccess: true, results: [] }`. */
  readonly batch?: Dispatcher["batch"];
};

/** Minimal mock dispatcher for renderer-web tests. Replaces the
 *  hand-rolled `makeDispatcher()` functions that were duplicated in nearly
 *  every test file. The returned `statusStore` is writable so tests can
 *  trigger status changes; the public dispatcher contract exposes it as
 *  read-only, but mocks may provide additional access.
 *
 *  Pending queues are always `[]` (live-dispatcher semantics). Tests that
 *  check savable pending behavior should mock the dispatcher themselves.
 */
export function createMockDispatcher(options: MockDispatcherOptions = {}): Dispatcher & {
  /** Writable access to the status store for test mutations.
   *  Aliases `dispatcher.statusStore`, but is typed as a
   *  WritableStore. */
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
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

// Shared fixtures for the KumikoScreen test files (kumiko-screen*.test.tsx).
export const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    done: { type: "boolean" },
  },
} as unknown as EntityDefinition;

/** Mock dispatcher whose default `query` returns an empty list page. */
export function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Fake-DraftStorage-Helper
// ---------------------------------------------------------------------------

/** In-memory DraftStorage for tests that need RenderEdit's create-mode
 *  draftId to survive a same-tab remount — the same role
 *  `sessionStorage` plays for `createBrowserDraftStorage()` in production.
 *  Fresh Map per call, so tests stay isolated from one another; wrap the
 *  SAME instance around both renders of a "simulated reload" test to prove
 *  persistence across the remount. */
export function createFakeDraftStorage(): DraftStorage {
  const store = new Map<string, string>();
  return {
    getDraftId: (screenId) => store.get(screenId) ?? null,
    setDraftId: (screenId, draftId) => {
      store.set(screenId, draftId);
    },
    clearDraftId: (screenId) => {
      store.delete(screenId);
    },
  };
}

export function setViewportWidth(width: number): void {
  (
    window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
  ).happyDOM.setInnerWidth(width);
}

/** Call inside a `describe`: restores the viewport width to its pre-test value after each test. */
export function restoreViewportWidthAfterEach(): void {
  let originalWidth = 0;
  beforeEach(() => {
    originalWidth = window.innerWidth;
  });
  afterEach(() => {
    setViewportWidth(originalWidth);
  });
}

export * from "@testing-library/react";
