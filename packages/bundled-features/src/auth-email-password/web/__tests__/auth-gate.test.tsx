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
});
