import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createSessionEndedSignal,
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
  SessionEndedSignalProvider,
  useUnsavedInputSource,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { type AuthGateOptions, makeAuthGate } from "../auth-gate.tsx";
import { defaultTranslations } from "../i18n.ts";
import { SessionProvider } from "../session.tsx";
import { clearCsrfCookie, setCsrfCookie } from "./test-utils.tsx";

const SESSION_ENDED_TEXT = "Your session has ended. Please sign in again.";

const originalReplace = window.location.replace;
const originalReload = window.location.reload;
const replaceMock = mock((_url: string | URL): void => {});
const reloadMock = mock((): void => {});

function DraftField(): ReactNode {
  const [value, setValue] = useState("");
  useUnsavedInputSource(() => value !== "");
  return <input aria-label="draft" value={value} onChange={(e) => setValue(e.target.value)} />;
}

function typeDraft(value: string): void {
  fireEvent.change(screen.getByLabelText("draft"), { target: { value } });
}

function draftValue(): string {
  const field = screen.getByLabelText("draft");
  expect(field instanceof HTMLInputElement).toBe(true);
  return field instanceof HTMLInputElement ? field.value : "";
}

function signInAgain(): void {
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "u@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw-1234567" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

// Real SessionProvider + default LoginScreen: proves the signal path end to
// end (notify → state reset → gate swaps children for the login screen).
describe("session-ended signal through SessionProvider and auth gate", () => {
  const resolver = createStaticLocaleResolver({ locale: "en" });
  const originalFetch = globalThis.fetch;

  function renderApp(
    signal: ReturnType<typeof createSessionEndedSignal>,
    gateOptions: AuthGateOptions = {},
    children: ReactNode = <div data-testid="protected">secret</div>,
  ) {
    const Gate = makeAuthGate(gateOptions);
    const ui: ReactNode = <Gate>{children}</Gate>;
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

  function mockBackendWithLogin(userIdAfterLogin: string): void {
    let currentUserId = "u1";
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
            data: { id: currentUserId, email: "u@example.com", displayName: "U", roles: "[]" },
          }),
          { status: 200 },
        );
      }
      if (url === "/api/auth/login") {
        currentUserId = userIdAfterLogin;
        setCsrfCookie("relogin-token");
        return new Response(
          JSON.stringify({
            isSuccess: true,
            token: "t",
            user: { id: userIdAfterLogin, tenantId: "t1", roles: [] },
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    setCsrfCookie("session-ended-test-token");
    replaceMock.mockClear();
    reloadMock.mockClear();
    window.location.replace = replaceMock as typeof window.location.replace;
    window.location.reload = reloadMock as typeof window.location.reload;
  });

  afterEach(() => {
    clearCsrfCookie();
    globalThis.fetch = originalFetch;
    window.location.replace = originalReplace;
    window.location.reload = originalReload;
  });

  test("notify while authenticated shows the login screen with the localized hint, children gone", async () => {
    mockSignedInBackend();
    const signal = createSessionEndedSignal();
    renderApp(signal);
    await waitFor(() => screen.getByTestId("protected"));

    act(() => signal.notify());

    await waitFor(() => screen.getByText(SESSION_ENDED_TEXT));
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  test("notify while unauthenticated shows no hint", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
    const signal = createSessionEndedSignal();
    renderApp(signal);
    await waitFor(() => screen.getByLabelText(/password/i));

    act(() => signal.notify());

    expect(screen.queryByText(SESSION_ENDED_TEXT)).toBeNull();
  });

  test("unsaved input survives a session end under a login dialog", async () => {
    mockSignedInBackend();
    const signal = createSessionEndedSignal();
    renderApp(signal, {}, <DraftField />);
    await waitFor(() => screen.getByLabelText("draft"));
    typeDraft("half typed");

    act(() => signal.notify());

    await waitFor(() => screen.getByText(SESSION_ENDED_TEXT));
    screen.getByRole("dialog");
    expect(draftValue()).toBe("half typed");
  });

  test("re-login as the same user closes the dialog and keeps the input usable", async () => {
    mockBackendWithLogin("u1");
    const signal = createSessionEndedSignal();
    renderApp(signal, {}, <DraftField />);
    await waitFor(() => screen.getByLabelText("draft"));
    typeDraft("half typed");
    act(() => signal.notify());
    await waitFor(() => screen.getByRole("dialog"));

    signInAgain();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(draftValue()).toBe("half typed");
    typeDraft("half typed, done");
    expect(draftValue()).toBe("half typed, done");
    expect(reloadMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("re-login as another user reloads the page", async () => {
    mockBackendWithLogin("u2");
    const signal = createSessionEndedSignal();
    renderApp(signal, {}, <DraftField />);
    await waitFor(() => screen.getByLabelText("draft"));
    typeDraft("half typed");
    act(() => signal.notify());
    await waitFor(() => screen.getByRole("dialog"));

    signInAgain();

    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
  });

  test("a gate with loginUrl shows the dialog instead of redirecting when input is kept", async () => {
    mockSignedInBackend();
    const signal = createSessionEndedSignal();
    renderApp(signal, { loginUrl: "https://example.com/login" }, <DraftField />);
    await waitFor(() => screen.getByLabelText("draft"));
    typeDraft("half typed");

    act(() => signal.notify());

    await waitFor(() => screen.getByRole("dialog"));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
