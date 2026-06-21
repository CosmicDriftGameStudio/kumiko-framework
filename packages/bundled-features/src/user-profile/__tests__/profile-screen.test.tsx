// Render-Test gegen echte i18n-Bundles (Welle-1-Prinzip: fängt fehlende
// Keys — der Screen darf nie rohe "profile.*"-Keys zeigen). Provider-
// Wrapper analog renderer-web/test-utils, hier lokal weil die
// Dependency-Richtung renderer-web → bundled-features verbietet.

import { describe, expect, spyOn, test } from "bun:test";
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
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";
import { formatDeletionDate, ProfileScreen } from "../web/profile-screen";

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
    // Card-Standard: jede Konto-Section ist GENAU eine Card (self + descendants)
    // — nicht mehr das alte <section bg-card> um eine Form-Card = doppelt.
    const cardCount = (el: Element): number =>
      (el.matches(".bg-card") ? 1 : 0) + el.querySelectorAll(".bg-card").length;
    expect(cardCount(view.getByTestId("profile-email"))).toBe(1);
    expect(cardCount(view.getByTestId("profile-password"))).toBe(1);
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
    // #322/2: nur der Datums-Teil, kein roher ISO-Zeitstempel mehr.
    expect(banner.textContent).not.toContain("T00:00");
    expect(banner.textContent).not.toContain(":00:00");
    expect(view.queryByTestId("profile-danger-delete")).toBeNull();
    expect(view.getByTestId("profile-danger-cancel")).toBeTruthy();
    expect(view.container.textContent).not.toContain("profile.");
  });

  // #322/3: nach erfolgreichem Email-Wechsel triggert der Screen den
  // Verification-Versand. Schlägt der fehl, darf der Erfolg nicht umkehren —
  // aber der Fehler wird nicht mehr stumm verschluckt (sonst wartet der User
  // auf eine Mail, die nie kommt) und die Success-Message verspricht keinen
  // Versand mehr.
  test("email change: verification-send failure is surfaced (not swallowed), change still succeeds", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in test"));
    try {
      const view = renderProfile(activeMe);
      await waitFor(() => {
        if (view.queryByTestId("profile-email-form") === null) throw new Error("not mounted yet");
      });

      const emailInput = view.container.querySelector<HTMLInputElement>("#profile-new-email");
      const pwInput = view.container.querySelector<HTMLInputElement>("#profile-email-password");
      if (!emailInput || !pwInput) throw new Error("email form inputs not found");
      fireEvent.change(emailInput, { target: { value: "new@example.com" } });
      fireEvent.change(pwInput, { target: { value: "current-pw" } });
      fireEvent.submit(view.getByTestId("profile-email-form"));

      // De-Swallow: der fehlgeschlagene Verification-Versand wird geloggt.
      await waitFor(() => {
        const warned = warnSpy.mock.calls.some((c) => String(c[0]).includes("[user-profile]"));
        if (!warned) throw new Error("verification-send failure not surfaced");
      });
      // Wechsel bleibt erfolgreich: das Eingabefeld wird zurückgesetzt.
      await waitFor(() => {
        if (emailInput.value !== "") throw new Error("email input not cleared after success");
      });
      // Die Success-Message verspricht keinen Link-Versand mehr.
      expect(view.container.textContent).not.toContain("verification link");
      expect(view.container.textContent).not.toContain("Bestätigungslink");
    } finally {
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe("formatDeletionDate", () => {
  test("ISO instant → date part only (strips time + Z)", () => {
    expect(formatDeletionDate("2026-07-11T00:00:00.000Z")).toBe("2026-07-11");
  });

  test("null / undefined / empty → em dash", () => {
    expect(formatDeletionDate(null)).toBe("—");
    expect(formatDeletionDate(undefined)).toBe("—");
    expect(formatDeletionDate("")).toBe("—");
  });

  test("date-only string without time → returned as-is", () => {
    expect(formatDeletionDate("2026-07-11")).toBe("2026-07-11");
  });
});
