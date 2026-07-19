import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SignupScreen } from "../signup-screen";
import { renderWithProviders } from "./test-utils";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fillEmail(value: string): void {
  fireEvent.change(document.getElementById("signup-email") as HTMLInputElement, {
    target: { value },
  });
}

describe("SignupScreen", () => {
  test("rendert title + email-input + submit-button (de)", () => {
    renderWithProviders(<SignupScreen />);
    expect(screen.getByText("Account erstellen")).toBeTruthy();
    expect(document.getElementById("signup-email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aktivierungs-Link senden" })).toBeTruthy();
  });

  test("submit ruft /api/auth/signup-request mit der Email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Aktivierungs-Link senden" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/signup-request",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "new@example.com" }),
        }),
      );
    });
  });

  test("nach erfolgreichem Submit: success-Banner + Resend", async () => {
    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Aktivierungs-Link senden" }));

    await waitFor(() => {
      expect(screen.getByText("Mail gesendet")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Mail erneut senden/i })).toBeTruthy();
  });

  test("rate_limited mit retryAfterSeconds → interpolated minutes", async () => {
    const errBody = JSON.stringify({
      error: { code: "rate_limited", details: { retryAfterSeconds: 120 } },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 429 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Aktivierungs-Link senden" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/2/);
    });
    expect(screen.queryByText("Mail gesendet")).toBeNull();
  });

  test("server 5xx → error-banner statt Success-State", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Aktivierungs-Link senden" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("schief");
    });
    expect(screen.queryByText("Mail gesendet")).toBeNull();
  });
});
