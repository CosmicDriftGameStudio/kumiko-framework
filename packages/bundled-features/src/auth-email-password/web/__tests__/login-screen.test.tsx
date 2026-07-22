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
      login: mock<SessionApi["login"]>(async () => ({
        kind: "failure",
        error: { reason: "invalid_credentials" },
      })),
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
      login: mock<SessionApi["login"]>(async () => ({
        kind: "failure",
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
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("vorübergehend gesperrt");
    });
    expect(screen.getByRole("link", { name: /Konto entsperren/i }).getAttribute("href")).toBe(
      "/unlock",
    );
  });

  test("reasonToKey covers no_membership, rate_limited, invalid_body, default", async () => {
    const cases: Array<{ reason: string; needle: string }> = [
      { reason: "no_membership", needle: "keinen Tenant-Zugang" },
      { reason: "rate_limited", needle: "Zu viele Login-Versuche" },
      { reason: "invalid_body", needle: "Ungültige Eingabe" },
      { reason: "weird_unknown", needle: "Login fehlgeschlagen" },
      { reason: "mfa_setup_required", needle: "Zwei-Faktor-Authentifizierung erforderlich" },
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
      fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
      fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
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
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
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
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/MFA|Zwei-Faktor|nicht unterstützt/i);
    });
  });

  test("mfa-setup-required with and without onMfaSetupRequired", async () => {
    const onMfaSetupRequired = mock<() => void>();
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
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
    await waitFor(() => {
      expect(onMfaSetupRequired).toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Zwei-Faktor-Authentifizierung erforderlich",
      );
    });
  });

  test("signupHref renders signup link", () => {
    renderWithProviders(<LoginScreen signupHref="/signup" />);
    const link = screen.getByRole("link", { name: "Account erstellen" });
    expect(link.getAttribute("href")).toBe("/signup");
  });
});
