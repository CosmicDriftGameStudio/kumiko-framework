import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ForgotPasswordScreen } from "../forgot-password-screen";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  globalThis.fetch = mock(async () => new Response(null, { status: 200 }));
});
afterEach(() => {});

describe("ForgotPasswordScreen", () => {
  test("rendert title + email-input + submit-button (de)", () => {
    renderWithProviders(<ForgotPasswordScreen />);
    expect(screen.getByText("Passwort zurücksetzen")).toBeTruthy();
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link anfordern" })).toBeTruthy();
  });

  test("submit ruft /api/auth/request-password-reset mit der Email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/request-password-reset",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
    });
  });

  test("nach erfolgreichem Submit: success-Banner + 'Zurück zum Login'-Link", async () => {
    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByText("Mail gesendet")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Zurück zum Login/i })).toBeTruthy();
  });

  test("server 5xx → error-banner statt Success-State", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 500 }));

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("schief");
    });
    expect(screen.queryByText("Mail gesendet")).toBeNull();
  });
});
