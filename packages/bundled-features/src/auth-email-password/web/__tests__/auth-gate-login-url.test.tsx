import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../../i18n.js";
import { makeSessionAuthGate, type SessionAuthGateOptions } from "../auth-gate.js";
import { useSession } from "../session.js";

const originalFetch = globalThis.fetch;
const originalReplace = window.location.replace;
const originalAssign = window.location.assign;
const originalReload = window.location.reload;

const replaceMock = mock((_url: string | URL): void => {});
const assignMock = mock((_url: string | URL): void => {});
const reloadMock = mock((): void => {});

function LogoutButton(): ReactNode {
  const { logout } = useSession();
  return (
    <button type="button" onClick={() => void logout()}>
      sign-out
    </button>
  );
}

function renderGate(options: SessionAuthGateOptions): void {
  const Gate = makeSessionAuthGate(options);
  render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[defaultTranslations]}
      >
        <Gate>
          <div data-testid="protected">secret</div>
          <LogoutButton />
        </Gate>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

function mockBackend(opts: { readonly signedIn: boolean }): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!opts.signedIn) return new Response(null, { status: 401 });
    if (url === "/api/auth/tenants") {
      return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), { status: 200 });
    }
    if (url === "/api/query") {
      return new Response(
        JSON.stringify({
          data: { id: "u1", email: "u@example.com", displayName: "U", roles: "[]" },
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  replaceMock.mockClear();
  assignMock.mockClear();
  reloadMock.mockClear();
  window.location.replace = replaceMock as typeof window.location.replace;
  window.location.assign = assignMock as typeof window.location.assign;
  window.location.reload = reloadMock as typeof window.location.reload;
});

afterEach(() => {
  window.location.replace = originalReplace;
  window.location.assign = originalAssign;
  window.location.reload = originalReload;
  globalThis.fetch = originalFetch;
  document.cookie = "kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("auth gate with loginUrl", () => {
  test("unauthenticated visit redirects to loginUrl with the current path as next", async () => {
    window.history.replaceState(null, "", "/a/settings?tab=2");
    mockBackend({ signedIn: false });

    renderGate({ loginUrl: "https://example.com/login" });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock.mock.calls[0]?.[0]).toBe(
      "https://example.com/login?next=%2Fa%2Fsettings%3Ftab%3D2",
    );
    expect(screen.queryByTestId("protected")).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  test("without loginUrl the built-in login screen renders and nothing navigates", async () => {
    mockBackend({ signedIn: false });

    renderGate({});

    await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("authenticated session does not redirect", async () => {
    document.cookie = "kumiko_csrf=login-url-test-token";
    mockBackend({ signedIn: true });

    renderGate({ loginUrl: "/login" });

    await waitFor(() => screen.getByTestId("protected"));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("a javascript: loginUrl is rejected when the gate is built", () => {
    expect(() => makeSessionAuthGate({ loginUrl: "javascript:alert(1)" })).toThrow(/loginUrl/);
  });
});

describe("logout target", () => {
  async function signInAndLogout(options: SessionAuthGateOptions): Promise<void> {
    document.cookie = "kumiko_csrf=logout-test-token";
    mockBackend({ signedIn: true });
    renderGate(options);
    await waitFor(() => screen.getByTestId("protected"));
    fireEvent.click(screen.getByRole("button", { name: "sign-out" }));
  }

  test("postLogoutUrl navigates there without reload and without racing the login redirect", async () => {
    await signInAndLogout({ postLogoutUrl: "https://example.com/bye", loginUrl: "/login" });

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("https://example.com/bye"));
    expect(reloadMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("without postLogoutUrl logout still reloads", async () => {
    await signInAndLogout({});

    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
    expect(assignMock).not.toHaveBeenCalled();
  });
});
