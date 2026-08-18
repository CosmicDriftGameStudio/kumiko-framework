import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { LoginScreen } from "../login-screen";
import type { SessionApi } from "../session";
import { makeSessionApi, renderWithProviders } from "./test-utils";

const requestEmailVerificationMock = mock<() => Promise<unknown>>(() => Promise.resolve());
const actual_authClient = await import("../auth-client");
mock.module("../auth-client", () => ({
  ...actual_authClient,
  requestEmailVerification: requestEmailVerificationMock,
}));

describe("LoginScreen", () => {
  beforeEach(() => {
    requestEmailVerificationMock.mockReset();
  });

  test("renders translated title + email + password labels (de)", () => {
    renderWithProviders(<LoginScreen />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText(/^Email/)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("submit calls session.login with form values", async () => {
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "demo@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(session.login).toHaveBeenCalledWith({
        email: "demo@example.com",
        password: "secret",
      });
    });
  });

  test("invalid_credentials → renders translated error message", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "failure",
        error: { reason: "invalid_credentials" },
      })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe("Invalid email or password.");
    });
  });

  test("account_locked with retryAfterSeconds renders interpolated minutes", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "failure",
        error: { reason: "account_locked", retryAfterSeconds: 540 },
      })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "x@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      // 540s → 9 minutes (Math.ceil)
      expect(screen.getByRole("alert").textContent).toMatch(/9 minutes/);
    });
  });

  test("forgotPasswordHref-prop → Link rendert mit korrektem href", () => {
    renderWithProviders(<LoginScreen forgotPasswordHref="/forgot-password" />);
    const link = screen.getByRole("link", { name: /Forgot password/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/forgot-password");
  });

  test("ohne forgotPasswordHref → KEIN Link (Login bleibt minimalistisch)", () => {
    renderWithProviders(<LoginScreen />);
    expect(screen.queryByRole("link", { name: /Forgot password/i })).toBeNull();
  });

  // Bug-Bash 2026-06-07 (Bug 1): Login-Screen ist oft die einzige
  // öffentliche Seite einer Admin-Domain — ohne erreichbares Impressum
  // verletzt die Domain die Impressumspflicht.
  test("legalLinks-prop → Impressum/Datenschutz-Links mit korrekten hrefs", () => {
    renderWithProviders(
      <LoginScreen
        legalLinks={[
          { label: "Impressum", href: "/legal/impressum" },
          { label: "Datenschutz", href: "/legal/datenschutz" },
        ]}
      />,
    );
    const nav = screen.getByTestId("login-legal-links");
    expect(nav).toBeTruthy();
    const imprint = screen.getByRole("link", { name: "Impressum" });
    expect(imprint.getAttribute("href")).toBe("/legal/impressum");
    const privacy = screen.getByRole("link", { name: "Datenschutz" });
    expect(privacy.getAttribute("href")).toBe("/legal/datenschutz");
  });

  test("ohne legalLinks → kein Legal-Footer (Opt-in der App)", () => {
    renderWithProviders(<LoginScreen />);
    expect(screen.queryByTestId("login-legal-links")).toBeNull();
  });

  // Resend-Flow: bei email_not_verified bietet der LoginScreen einen
  // "Send verification email again"-Link im Fehler-Banner an.
  describe("resend verification on email_not_verified", () => {
    async function loginUntilEmailNotVerified(): Promise<void> {
      fireEvent.change(screen.getByLabelText(/^Email/), {
        target: { value: "demo@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/^Password/), {
        target: { value: "secret" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeTruthy();
      });
    }

    function unverifiedSession() {
      return makeSessionApi({
        status: "unauthenticated",
        user: null,
        login: mock<SessionApi["login"]>(async () => ({
          kind: "failure",
          error: { reason: "email_not_verified" },
        })),
      });
    }

    test("renders resend button only after email_not_verified failure", async () => {
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      // Vor Submit gibt es keinen Resend-Trigger
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
      await loginUntilEmailNotVerified();
      expect(screen.getByRole("button", { name: "Send verification email again" })).toBeTruthy();
    });

    test("click → calls requestEmailVerification with form email and shows success banner", async () => {
      requestEmailVerificationMock.mockResolvedValueOnce({ ok: true });
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();

      fireEvent.click(screen.getByRole("button", { name: "Send verification email again" }));

      await waitFor(() => {
        expect(requestEmailVerificationMock).toHaveBeenCalledWith("demo@example.com");
      });
      // Banner variant="info" setzt kein role — wir suchen per Text
      await waitFor(() => {
        expect(screen.getByText("We've sent you a new verification email.")).toBeTruthy();
      });
      // Fehler-Banner (role=alert) ist weg, Success-Banner ist da
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("rate_limited → inline hint statt success", async () => {
      requestEmailVerificationMock.mockResolvedValueOnce({
        ok: false,
        error: { reason: "rate_limited" },
      });
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();

      fireEvent.click(screen.getByRole("button", { name: "Send verification email again" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/Please wait a moment and try again/);
      });
      // Original-Fehler bleibt sichtbar
      expect(screen.getByRole("alert").textContent).toMatch(/Email address not yet verified/);
    });

    test("network/unknown error → generischer inline hint", async () => {
      requestEmailVerificationMock.mockRejectedValueOnce(new Error("offline"));
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();

      fireEvent.click(screen.getByRole("button", { name: "Send verification email again" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/Could not send. Please try again/);
      });
    });

    test("Email-Änderung nach Failure → Resend-Button verschwindet (anti-typo-Falle)", async () => {
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();
      expect(screen.getByRole("button", { name: "Send verification email again" })).toBeTruthy();

      // User korrigiert die Email-Eingabe — Resend-Button darf nicht mehr
      // sichtbar sein, damit kein silent-send an typo-Adresse passiert
      fireEvent.change(screen.getByLabelText(/^Email/), {
        target: { value: "typo@example.com" },
      });
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
    });

    test("invalid_credentials → KEIN Resend-Button (nur bei email_not_verified)", async () => {
      const session = makeSessionApi({
        status: "unauthenticated",
        user: null,
        login: mock<SessionApi["login"]>(async () => ({
          kind: "failure",
          error: { reason: "invalid_credentials" },
        })),
      });
      renderWithProviders(<LoginScreen />, { session });
      await loginUntilEmailNotVerified();
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
    });
  });

  test("account_locked without retry → unlock link when href set", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "failure",
        error: { reason: "account_locked" },
      })),
    });
    renderWithProviders(<LoginScreen unlockAccountHref="/unlock" />, { session });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("temporarily locked");
    });
    expect(screen.getByRole("link", { name: /Unlock account/i }).getAttribute("href")).toBe(
      "/unlock",
    );
  });

  test("reasonToKey covers no_membership, rate_limited, invalid_body, default", async () => {
    const cases: Array<{ reason: string; needle: string }> = [
      { reason: "no_membership", needle: "no tenant access" },
      { reason: "rate_limited", needle: "Too many login attempts" },
      { reason: "invalid_body", needle: "Invalid input" },
      { reason: "weird_unknown", needle: "Login failed" },
      { reason: "mfa_setup_required", needle: "Two-factor authentication required" },
    ];
    for (const { reason, needle } of cases) {
      const session = makeSessionApi({
        status: "unauthenticated",
        user: null,
        login: mock<SessionApi["login"]>(async () => ({
          kind: "failure",
          error: { reason },
        })),
      });
      const { unmount } = renderWithProviders(<LoginScreen />, { session });
      fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain(needle);
      });
      unmount();
    }
  });

  test("mfa-challenge with onMfaChallenge fires token", async () => {
    const onMfaChallenge = mock<(t: string) => void>();
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "mfa-challenge",
        challengeToken: "chal-1",
      })),
    });
    renderWithProviders(<LoginScreen onMfaChallenge={onMfaChallenge} />, { session });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(onMfaChallenge).toHaveBeenCalledWith("chal-1");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("mfa-challenge without callback → mfa_not_supported", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "mfa-challenge",
        challengeToken: "chal-1",
      })),
    });
    renderWithProviders(<LoginScreen />, { session });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("doesn't support two-factor");
    });
  });

  test("mfa-setup-required with and without onMfaSetupRequired", async () => {
    const onMfaSetupRequired = mock<(preauthSetupToken: string, accountLabel: string) => void>();
    const sessionOk = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "mfa-setup-required",
        preauthSetupToken: "setup-token-value",
      })),
    });
    const { unmount } = renderWithProviders(
      <LoginScreen onMfaSetupRequired={onMfaSetupRequired} />,
      { session: sessionOk },
    );
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(onMfaSetupRequired).toHaveBeenCalledWith("setup-token-value", "a@b.c");
    });
    unmount();

    const sessionBare = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock<SessionApi["login"]>(async () => ({
        kind: "mfa-setup-required",
        preauthSetupToken: "setup-token-value",
      })),
    });
    renderWithProviders(<LoginScreen />, { session: sessionBare });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Two-factor authentication required");
    });
  });

  test("signupHref renders signup link", () => {
    renderWithProviders(<LoginScreen signupHref="/signup" />);
    const link = screen.getByRole("link", { name: "Create account" });
    expect(link.getAttribute("href")).toBe("/signup");
  });
});
