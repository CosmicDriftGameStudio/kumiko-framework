import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createLoginRoute, makeAuthGate } from "../auth-gate";
import { makeSessionApi, renderWithProviders } from "./test-utils";

describe("makeAuthGate", () => {
  function CustomLogin(): ReactNode {
    return <div data-testid="custom-login">custom-login</div>;
  }

  test("loading → renders placeholder, not children, not login", () => {
    const Gate = makeAuthGate(CustomLogin);
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
    const Gate = makeAuthGate(CustomLogin);
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
    const Gate = makeAuthGate(CustomLogin);
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

  test("makeAuthGate delegates mfaVerifyScreen wiring to createLoginRoute", () => {
    const Gate = makeAuthGate(LoginWithMfaTrigger, undefined, CustomMfaVerify);
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

  test("MfaSetupComponent onSuccess → gate clears the request and refreshes the session", () => {
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
    expect(screen.queryByTestId("mfa-setup")).toBeNull();
  });

  test("makeAuthGate delegates mfaSetupScreen wiring to createLoginRoute", () => {
    const Gate = makeAuthGate(LoginWithMfaSetupTrigger, undefined, undefined, CustomMfaSetup);
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
