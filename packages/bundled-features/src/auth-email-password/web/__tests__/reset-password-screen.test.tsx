import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ResetPasswordScreen } from "../reset-password-screen";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {});

describe("ResetPasswordScreen", () => {
  test("ohne Token in URL UND ohne token-Prop → missing-token-Page", () => {
    // jsdom default location is "about:blank" → search = ""
    renderWithProviders(<ResetPasswordScreen />);
    expect(screen.getByText(/enthält keinen Token/i)).toBeTruthy();
  });

  test("mit token-Prop → Form rendert", () => {
    renderWithProviders(<ResetPasswordScreen token="abc-token" />);
    expect(screen.getByLabelText(/^Neues Passwort/)).toBeTruthy();
    expect(screen.getByLabelText(/^Passwort bestätigen/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Passwort speichern" })).toBeTruthy();
  });

  test("Passwort < 8 Zeichen → client-side error, kein fetch-Call", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ResetPasswordScreen token="abc" />);
    fireEvent.change(screen.getByLabelText(/^Neues Passwort/), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/^Passwort bestätigen/), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("8 Zeichen");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("mismatch zwischen Passwort und Confirm → client-side error", async () => {
    renderWithProviders(<ResetPasswordScreen token="abc" />);
    fireEvent.change(screen.getByLabelText(/^Neues Passwort/), {
      target: { value: "validpass1" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort bestätigen/), {
      target: { value: "differentpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht überein");
    });
  });

  test("happy path: gültiges Passwort → fetch-Call + success-State", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ResetPasswordScreen token="abc-token" />);
    fireEvent.change(screen.getByLabelText(/^Neues Passwort/), {
      target: { value: "validpass1" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort bestätigen/), {
      target: { value: "validpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/reset-password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "abc-token", newPassword: "validpass1" }),
        }),
      );
      expect(screen.getByText("Passwort gesetzt")).toBeTruthy();
    });
  });

  test("server invalid_reset_token → mapped i18n-error im UI", async () => {
    const errBody = JSON.stringify({
      error: { code: "invalid_reset_token", details: { reason: "invalid_reset_token" } },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<ResetPasswordScreen token="bad" />);
    fireEvent.change(screen.getByLabelText(/^Neues Passwort/), {
      target: { value: "validpass1" },
    });
    fireEvent.change(screen.getByLabelText(/^Passwort bestätigen/), {
      target: { value: "validpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("ungültig");
    });
  });
});
