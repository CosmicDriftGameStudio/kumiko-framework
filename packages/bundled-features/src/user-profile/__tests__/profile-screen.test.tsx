// Render-Test gegen echte i18n-Bundles (Welle-1-Prinzip: fängt fehlende
// Keys — der Screen darf nie rohe "profile.*"-Keys zeigen). Provider-
// Wrapper analog renderer-web/test-utils, hier lokal weil die
// Dependency-Richtung renderer-web → bundled-features verbietet.

import { describe, expect, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";
import { ProfileScreen } from "../web/profile-screen";

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();

function makeDispatcher(me: Record<string, unknown>): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: me })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderProfile(me: Record<string, unknown>) {
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={makeDispatcher(me)}>{children}</DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  return render(<ProfileScreen />, { wrapper });
}

const activeMe = {
  id: "00000000-0000-4000-8000-000000000042",
  email: "marc@example.com",
  status: "active",
  gracePeriodEnd: null,
};

describe("ProfileScreen", () => {
  test("aktiver User: alle drei Sektionen, Texte übersetzt (keine rohen Keys)", async () => {
    const view = renderProfile(activeMe);
    await waitFor(() => {
      if (view.queryByTestId("profile-screen") === null) throw new Error("not mounted yet");
    });
    expect(view.getByTestId("profile-email")).toBeTruthy();
    expect(view.getByTestId("profile-password")).toBeTruthy();
    expect(view.getByTestId("profile-danger")).toBeTruthy();
    expect(view.getByTestId("profile-email-current").textContent).toContain("marc@example.com");
    expect(view.getByTestId("profile-danger-delete")).toBeTruthy();
    // Echte i18n: kein einziger roher Key im sichtbaren Text.
    expect(view.container.textContent).not.toContain("profile.");
  });

  test("deletionRequested: Frist-Banner + Abbrechen statt Lösch-Button", async () => {
    const view = renderProfile({
      ...activeMe,
      status: "deletionRequested",
      gracePeriodEnd: "2026-07-11T00:00:00Z",
    });
    await waitFor(() => {
      if (view.queryByTestId("profile-screen") === null) throw new Error("not mounted yet");
    });
    const banner = view.getByTestId("profile-danger-requested");
    expect(banner.textContent).toContain("2026-07-11");
    expect(banner.textContent).not.toContain("{date}");
    expect(view.queryByTestId("profile-danger-delete")).toBeNull();
    expect(view.getByTestId("profile-danger-cancel")).toBeTruthy();
    expect(view.container.textContent).not.toContain("profile.");
  });
});
