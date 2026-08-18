import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ForgotPasswordScreen } from "../forgot-password-screen";
import { installFetchMock } from "./fetch-mock";
import { renderWithProviders } from "./test-utils";

installFetchMock();

describe("ForgotPasswordScreen", () => {
  test("rendert title + email-input + submit-button (de)", () => {
    renderWithProviders(<ForgotPasswordScreen />);
    expect(screen.getByText("Reset password")).toBeTruthy();
    expect(screen.getByLabelText(/^Email/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request link" })).toBeTruthy();
  });

  test("submit ruft /api/auth/request-password-reset mit der Email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

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

  test("nach erfolgreichem Submit: success-Banner + 'Back to login'-Link", async () => {
    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByText("Email sent")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Back to sign in/i })).toBeTruthy();
  });

  test("server 5xx → error-banner statt Success-State", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("wrong");
    });
    expect(screen.queryByText("Email sent")).toBeNull();
  });
});
