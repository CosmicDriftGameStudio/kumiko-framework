// Gate path-routing: requestPath → request screen, confirmPath → confirm
// screen, sonst durch zu children. Bewusst SYNCHRON (kein fireEvent/waitFor) —
// der #457-CI-Flake trifft nur await-Assertions auf dem geteilten happy-dom-
// document; ein Render + Sync-Assert im selben Tick ist nicht exponiert.
// Provider-Wrapper lokal (Dependency-Richtung renderer-web → bundled-features
// verbietet test-utils-Import).

import { afterEach, describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";
import { makePublicDeletionGate } from "../public-deletion-gate";

const resolver = createStaticLocaleResolver({ locale: "de" });
const stubDispatcher = {
  write: async () => ({ isSuccess: true, data: {} }),
} as unknown as Dispatcher;

const ROUTES = { requestPath: "/account/delete", confirmPath: "/account/delete/confirm" };

// renderGate mutates the shared happy-dom document's history (570/1) — reset
// so a later, unrelated test file doesn't inherit this suite's last path.
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function renderGate(path: string, gate: ReactNode): ReturnType<typeof within> {
  window.history.replaceState({}, "", path);
  const { container } = render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={resolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={stubDispatcher}>{gate}</DispatcherProvider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
  return within(container);
}

describe("makePublicDeletionGate", () => {
  test("requestPath → request screen, children short-circuited", () => {
    const Gate = makePublicDeletionGate(ROUTES);
    const ui = renderGate(
      "/account/delete",
      <Gate>
        <div data-testid="app">APP</div>
      </Gate>,
    );
    expect(ui.getByText(/beantragen/)).toBeTruthy();
    expect(ui.queryByTestId("app")).toBeNull();
  });

  test("confirmPath → confirm screen, children short-circuited", () => {
    const Gate = makePublicDeletionGate(ROUTES);
    const ui = renderGate(
      "/account/delete/confirm",
      <Gate>
        <div data-testid="app">APP</div>
      </Gate>,
    );
    expect(ui.getByText(/bestätigen/)).toBeTruthy();
    expect(ui.queryByTestId("app")).toBeNull();
  });

  test("other path → children pass through, no deletion screen", () => {
    const Gate = makePublicDeletionGate(ROUTES);
    const ui = renderGate(
      "/dashboard",
      <Gate>
        <div data-testid="app">APP</div>
      </Gate>,
    );
    expect(ui.getByTestId("app")).toBeTruthy();
    expect(ui.queryByText(/beantragen/)).toBeNull();
  });

  test("custom shell wraps the matched screen", () => {
    const Gate = makePublicDeletionGate({
      ...ROUTES,
      shell: (screen) => <div data-testid="shell">{screen}</div>,
    });
    const ui = renderGate(
      "/account/delete",
      <Gate>
        <span>APP</span>
      </Gate>,
    );
    const shell = ui.getByTestId("shell");
    expect(within(shell).getByText(/beantragen/)).toBeTruthy();
  });
});
