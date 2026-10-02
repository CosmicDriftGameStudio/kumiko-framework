import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createSessionEndedSignal,
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
  SessionEndedSignalProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../../i18n.js";
import { makeAuthGate } from "../auth-gate.js";
import { SessionProvider } from "../session.js";

const SESSION_ENDED_TEXT = "Your session has ended. Please sign in again.";

// Real SessionProvider + default LoginScreen: proves the signal path end to
// end (notify → state reset → gate swaps children for the login screen).
describe("session-ended signal through SessionProvider and auth gate", () => {
  const resolver = createStaticLocaleResolver({ locale: "en" });
  const originalFetch = globalThis.fetch;

  function renderApp(signal: ReturnType<typeof createSessionEndedSignal>) {
    const Gate = makeAuthGate();
    const ui: ReactNode = (
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>
    );
    return render(
      <PrimitivesProvider value={defaultPrimitives}>
        <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
          <SessionEndedSignalProvider signal={signal}>
            <SessionProvider>{ui}</SessionProvider>
          </SessionEndedSignalProvider>
        </LocaleProvider>
      </PrimitivesProvider>,
    );
  }

  function mockSignedInBackend(): void {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), {
          status: 200,
        });
      }
      if (url === "/api/query") {
        return new Response(
          JSON.stringify({
            data: { id: "u1", email: "u@example.com", displayName: "U", roles: "[]" },
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    document.cookie = "kumiko_csrf=session-ended-test-token";
  });

  afterEach(() => {
    document.cookie = "kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    globalThis.fetch = originalFetch;
  });

  test("notify while authenticated shows the login screen with the localized hint, children gone", async () => {
    mockSignedInBackend();
    const signal = createSessionEndedSignal();
    renderApp(signal);
    await waitFor(() => screen.getByTestId("protected"));

    act(() => signal.notify());

    await waitFor(() => expect(screen.getByText(SESSION_ENDED_TEXT)).toBeTruthy());
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  test("notify while unauthenticated shows no hint", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
    const signal = createSessionEndedSignal();
    renderApp(signal);
    await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeTruthy());

    act(() => signal.notify());

    expect(screen.queryByText(SESSION_ENDED_TEXT)).toBeNull();
  });
});
