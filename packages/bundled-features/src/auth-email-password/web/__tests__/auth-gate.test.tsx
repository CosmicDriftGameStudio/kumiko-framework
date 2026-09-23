import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../../i18n";
import { createLoginRoute, makeAuthGate } from "../auth-gate";
import { SessionProvider } from "../session";
import { makeSessionApi, renderWithProviders } from "./test-utils";

describe("makeAuthGate", () => {
  function CustomLogin(): ReactNode {
    return <div data-testid="custom-login">custom-login</div>;
  }

  test("loading → renders placeholder, not children, not login", () => {
    const Gate = makeAuthGate({ loginScreen: CustomLogin });
    const session = makeSessionApi({ status: "loading", user: null });
    const { container } = renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    expect(screen.queryByTestId("protected")).toBeNull();
    expect(screen.queryByTestId("custom-login")).toBeNull();
    // Placeholder div ist gerendert (kein leerer Tree)
    expect(container.firstChild).not.toBeNull();
  });

  test("unauthenticated → renders LoginComponent, not children", () => {
    const Gate = makeAuthGate({ loginScreen: CustomLogin });
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    expect(screen.getByTestId("custom-login")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  test("authenticated → renders children, not login", () => {
    const Gate = makeAuthGate({ loginScreen: CustomLogin });
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(screen.queryByTestId("custom-login")).toBeNull();
  });
});

describe("createLoginRoute", () => {
  function CustomLogin(): ReactNode {
    return <div data-testid="custom-login">custom-login</div>;
  }

  function LoginWithMfaTrigger({
    onMfaChallenge,
  }: {
    readonly onMfaChallenge?: (challengeToken: string) => void;
  }): ReactNode {
    return (
      <button type="button" data-testid="trigger-mfa" onClick={() => onMfaChallenge?.("token-123")}>
        trigger
      </button>
    );
  }

  function CustomMfaVerify({ challengeToken }: { readonly challengeToken: string }): ReactNode {
    return <div data-testid="mfa-verify">{challengeToken}</div>;
  }

  function LoginWithMfaSetupTrigger({
    onMfaSetupRequired,
  }: {
    readonly onMfaSetupRequired?: (preauthSetupToken: string, accountLabel: string) => void;
  }): ReactNode {
    return (
      <button
        type="button"
        data-testid="trigger-mfa-setup"
        onClick={() => onMfaSetupRequired?.("setup-token-123", "user@example.com")}
      >
        trigger
      </button>
    );
  }

  function CustomMfaSetup({
    preauthSetupToken,
    accountLabel,
    onSuccess,
  }: {
    readonly preauthSetupToken: string;
    readonly accountLabel: string;
    readonly onSuccess?: () => void;
  }): ReactNode {
    return (
      <div data-testid="mfa-setup">
        <span data-testid="mfa-setup-info">
          {preauthSetupToken}:{accountLabel}
        </span>
        <button type="button" data-testid="complete-mfa-setup" onClick={() => onSuccess?.()}>
          complete
        </button>
      </div>
    );
  }

  test("authenticated + onAuthenticated → renders nothing, fires onAuthenticated exactly once", () => {
    const onAuthenticated = mock(() => {});
    const LoginRoute = createLoginRoute({ loginScreen: CustomLogin, onAuthenticated });
    const session = makeSessionApi({ status: "authenticated" });
    const { container } = renderWithProviders(<LoginRoute />, { session });
    expect(container.firstChild).toBeNull();
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  test("authenticated without onAuthenticated → falls through to LoginComponent (standalone mount)", () => {
    const LoginRoute = createLoginRoute({ loginScreen: CustomLogin });
    const session = makeSessionApi({ status: "authenticated" });
    renderWithProviders(<LoginRoute />, { session });
    expect(screen.getByTestId("custom-login")).toBeTruthy();
  });

  test("onMfaChallenge → renders MfaVerifyComponent with the challenge token", () => {
    const LoginRoute = createLoginRoute({
      loginScreen: LoginWithMfaTrigger,
      mfaVerifyScreen: CustomMfaVerify,
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(<LoginRoute />, { session });
    fireEvent.click(screen.getByTestId("trigger-mfa"));
    expect(screen.getByTestId("mfa-verify").textContent).toBe("token-123");
  });

  test("no mfaVerifyScreen → onMfaChallenge passes through to loginScreenProps.onMfaChallenge (#266 footgun)", () => {
    // The silent-no-MFA-fallback path: an app that wires its own
    // onMfaChallenge via loginScreenProps but forgets mfaVerifyScreen still
    // gets that callback invoked (createLoginRoute can't detect the
    // omission) instead of the internal setChallengeToken/MfaVerifyComponent
    // machinery kicking in. Covered here so a future refactor of that
    // ternary can't silently swap the fallback direction.
    const onMfaChallenge = mock<(challengeToken: string) => void>();
    const LoginRoute = createLoginRoute({
      loginScreen: LoginWithMfaTrigger,
      loginScreenProps: { onMfaChallenge },
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(<LoginRoute />, { session });
    fireEvent.click(screen.getByTestId("trigger-mfa"));
    expect(onMfaChallenge).toHaveBeenCalledWith("token-123");
    expect(screen.queryByTestId("mfa-verify")).toBeNull();
  });

  test("makeAuthGate delegates mfaVerifyScreen wiring to createLoginRoute", () => {
    const Gate = makeAuthGate({
      loginScreen: LoginWithMfaTrigger,
      mfaVerifyScreen: CustomMfaVerify,
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    fireEvent.click(screen.getByTestId("trigger-mfa"));
    expect(screen.getByTestId("mfa-verify").textContent).toBe("token-123");
  });

  test("onMfaSetupRequired → renders MfaSetupComponent with token and accountLabel", () => {
    const LoginRoute = createLoginRoute({
      loginScreen: LoginWithMfaSetupTrigger,
      mfaSetupScreen: CustomMfaSetup,
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(<LoginRoute />, { session });
    fireEvent.click(screen.getByTestId("trigger-mfa-setup"));
    expect(screen.getByTestId("mfa-setup-info").textContent).toBe(
      "setup-token-123:user@example.com",
    );
  });

  test("MfaSetupComponent onSuccess → gate clears the request and refreshes the session", async () => {
    const LoginRoute = createLoginRoute({
      loginScreen: LoginWithMfaSetupTrigger,
      mfaSetupScreen: CustomMfaSetup,
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(<LoginRoute />, { session });
    fireEvent.click(screen.getByTestId("trigger-mfa-setup"));
    expect(screen.getByTestId("mfa-setup")).toBeTruthy();
    fireEvent.click(screen.getByTestId("complete-mfa-setup"));
    expect(session.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByTestId("mfa-setup")).toBeNull();
    });
  });

  test("MfaSetupComponent onSuccess → keeps setup screen when refresh rejects", async () => {
    const LoginRoute = createLoginRoute({
      loginScreen: LoginWithMfaSetupTrigger,
      mfaSetupScreen: CustomMfaSetup,
    });
    const session = makeSessionApi({
      status: "unauthenticated",
      refresh: mock(async () => {
        throw new Error("refresh failed");
      }),
    });
    renderWithProviders(<LoginRoute />, { session });
    fireEvent.click(screen.getByTestId("trigger-mfa-setup"));
    fireEvent.click(screen.getByTestId("complete-mfa-setup"));
    expect(session.refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId("mfa-setup")).toBeTruthy();
  });

  test("makeAuthGate delegates mfaSetupScreen wiring to createLoginRoute", () => {
    const Gate = makeAuthGate({
      loginScreen: LoginWithMfaSetupTrigger,
      mfaSetupScreen: CustomMfaSetup,
    });
    const session = makeSessionApi({ status: "unauthenticated" });
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    fireEvent.click(screen.getByTestId("trigger-mfa-setup"));
    expect(screen.getByTestId("mfa-setup-info").textContent).toBe(
      "setup-token-123:user@example.com",
    );
  });
});

// Real SessionProvider (no mocked SessionContext) — proves the actual
// bootstrap-failure wiring end to end: hasLikelyAuthSession → fetchTenants
// throws → doRefresh catches → "error" status → SessionBootstrapErrorScreen.
// Uses makeAuthGate + SessionProvider directly instead of makeSessionAuthGate:
// client-plugin.test.tsx mocks makeSessionAuthGate process-wide via bun:test's
// shared module registry, which would silently no-op it here too.
describe("makeSessionAuthGate — session bootstrap failure", () => {
  const resolver = createStaticLocaleResolver({ locale: "en" });
  const originalFetch = globalThis.fetch;

  function renderRealSession(ui: ReactNode) {
    return render(
      <PrimitivesProvider value={defaultPrimitives}>
        <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
          <SessionProvider>{ui}</SessionProvider>
        </LocaleProvider>
      </PrimitivesProvider>,
    );
  }

  beforeEach(() => {
    document.cookie = "kumiko_csrf=gate-test-token";
  });

  afterEach(() => {
    document.cookie = "kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    globalThis.fetch = originalFetch;
  });

  test("429 on GET /auth/tenants → error screen with data-http-status=429, children not rendered; retry recovers", async () => {
    let tenantsCalls = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        tenantsCalls++;
        if (tenantsCalls === 1) return new Response(null, { status: 429 });
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

    const Gate = makeAuthGate();
    renderRealSession(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
    );

    const errorScreen = await waitFor(() => screen.getByTestId("session-bootstrap-error"));
    expect(errorScreen.getAttribute("data-http-status")).toBe("429");
    expect(screen.queryByTestId("protected")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByTestId("protected")).toBeTruthy();
    });
    expect(tenantsCalls).toBe(2);
  });

  test("500 on POST /api/query (user:me) → error screen with data-http-status=500, children not rendered", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), {
          status: 200,
        });
      }
      if (url === "/api/query") {
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const Gate = makeAuthGate();
    renderRealSession(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
    );

    const errorScreen = await waitFor(() => screen.getByTestId("session-bootstrap-error"));
    expect(errorScreen.getAttribute("data-http-status")).toBe("500");
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  test("network failure on GET /auth/tenants → error screen with data-http-status=network", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const Gate = makeAuthGate();
    renderRealSession(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
    );

    const errorScreen = await waitFor(() => screen.getByTestId("session-bootstrap-error"));
    expect(errorScreen.getAttribute("data-http-status")).toBe("network");
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});
