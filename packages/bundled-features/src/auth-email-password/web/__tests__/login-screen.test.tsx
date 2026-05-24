import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { LoginScreen } from "../login-screen";
import { makeSessionApi, renderWithProviders } from "./test-utils";

const requestEmailVerificationMock = mock(() => undefined);
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
    expect(screen.getByText("Anmelden")).toBeTruthy();
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
    expect(screen.getByLabelText(/^Passwort/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einloggen" })).toBeTruthy();
  });

  test("submit calls session.login with form values", async () => {
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "demo@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort/), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

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
      login: mock(async () => ({ ok: false, error: { reason: "invalid_credentials" } })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe("E-Mail oder Passwort falsch.");
    });
  });

  test("account_locked with retryAfterSeconds renders interpolated minutes", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: mock(async () => ({
        ok: false,
        error: { reason: "account_locked", retryAfterSeconds: 540 },
      })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "x@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

    await waitFor(() => {
      // 540s → 9 Minuten (Math.ceil)
      expect(screen.getByRole("alert").textContent).toMatch(/9 Minuten/);
    });
  });

  test("forgotPasswordHref-prop → Link rendert mit korrektem href", () => {
    renderWithProviders(<LoginScreen forgotPasswordHref="/forgot-password" />);
    const link = screen.getByRole("link", { name: /Passwort vergessen/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/forgot-password");
  });

  test("ohne forgotPasswordHref → KEIN Link (Login bleibt minimalistisch)", () => {
    renderWithProviders(<LoginScreen />);
    expect(screen.queryByRole("link", { name: /Passwort vergessen/i })).toBeNull();
  });

  // Resend-Flow: bei email_not_verified bietet der LoginScreen einen
  // "Bestätigungs-Mail erneut senden"-Link im Fehler-Banner an.
  describe("resend verification on email_not_verified", () => {
    async function loginUntilEmailNotVerified(): Promise<void> {
      fireEvent.change(screen.getByLabelText(/^E-Mail/), {
        target: { value: "demo@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/^Passwort/), {
        target: { value: "secret" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeTruthy();
      });
    }

    function unverifiedSession() {
      return makeSessionApi({
        status: "unauthenticated",
        user: null,
        login: mock(async () => ({ ok: false, error: { reason: "email_not_verified" } })),
      });
    }

    test("renders resend button only after email_not_verified failure", async () => {
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      // Vor Submit gibt es keinen Resend-Trigger
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
      await loginUntilEmailNotVerified();
      expect(screen.getByRole("button", { name: "Bestätigungs-Mail erneut senden" })).toBeTruthy();
    });

    test("click → calls requestEmailVerification with form email and shows success banner", async () => {
      requestEmailVerificationMock.mockResolvedValueOnce({ ok: true });
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();

      fireEvent.click(screen.getByRole("button", { name: "Bestätigungs-Mail erneut senden" }));

      await waitFor(() => {
        expect(requestEmailVerificationMock).toHaveBeenCalledWith("demo@example.com");
      });
      // Banner variant="info" setzt kein role — wir suchen per Text
      await waitFor(() => {
        expect(
          screen.getByText("Wir haben dir eine neue Bestätigungs-Mail geschickt."),
        ).toBeTruthy();
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

      fireEvent.click(screen.getByRole("button", { name: "Bestätigungs-Mail erneut senden" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /Bitte warte kurz und versuche es erneut/,
        );
      });
      // Original-Fehler bleibt sichtbar
      expect(screen.getByRole("alert").textContent).toMatch(/E-Mail-Adresse noch nicht bestätigt/);
    });

    test("network/unknown error → generischer inline hint", async () => {
      requestEmailVerificationMock.mockRejectedValueOnce(new Error("offline"));
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();

      fireEvent.click(screen.getByRole("button", { name: "Bestätigungs-Mail erneut senden" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /Konnte nicht senden. Bitte erneut versuchen/,
        );
      });
    });

    test("Email-Änderung nach Failure → Resend-Button verschwindet (anti-typo-Falle)", async () => {
      renderWithProviders(<LoginScreen />, { session: unverifiedSession() });
      await loginUntilEmailNotVerified();
      expect(screen.getByRole("button", { name: "Bestätigungs-Mail erneut senden" })).toBeTruthy();

      // User korrigiert die Email-Eingabe — Resend-Button darf nicht mehr
      // sichtbar sein, damit kein silent-send an typo-Adresse passiert
      fireEvent.change(screen.getByLabelText(/^E-Mail/), {
        target: { value: "typo@example.com" },
      });
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
    });

    test("invalid_credentials → KEIN Resend-Button (nur bei email_not_verified)", async () => {
      const session = makeSessionApi({
        status: "unauthenticated",
        user: null,
        login: mock(async () => ({ ok: false, error: { reason: "invalid_credentials" } })),
      });
      renderWithProviders(<LoginScreen />, { session });
      await loginUntilEmailNotVerified();
      expect(screen.queryByRole("button", { name: /erneut senden/i })).toBeNull();
    });
  });
});
