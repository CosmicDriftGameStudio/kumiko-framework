import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { RequestAccountUnlockScreen } from "../request-account-unlock-screen";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {});

describe("RequestAccountUnlockScreen", () => {
  test("renders title + email input + submit (de)", () => {
    renderWithProviders(<RequestAccountUnlockScreen />);
    expect(screen.getByText("Konto entsperren")).toBeTruthy();
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link anfordern" })).toBeTruthy();
  });

  test("submit posts /api/auth/request-account-unlock with email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/request-account-unlock",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
    });
  });

  test("success → silent-success banner + back-to-login link", async () => {
    renderWithProviders(<RequestAccountUnlockScreen loginHref="/signin" />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByText("Mail gesendet")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Zurück zum Login/i }).getAttribute("href")).toBe(
      "/signin",
    );
  });

  test("429 with retryAfterSeconds → accountLockedRetry banner", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: { details: { retryAfterSeconds: 180 } } }), {
          status: 429,
        }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("3 Minuten");
    });
    expect(screen.queryByText("Mail gesendet")).toBeNull();
  });

  test("429 without retryAfterSeconds → generic rateLimited banner", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Zu viele Login-Versuche");
    });
  });

  test("server 5xx → unknownError banner, stays on form", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("schief");
    });
    expect(screen.queryByText("Mail gesendet")).toBeNull();
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
  });

  test("fetch throw → unknownError banner", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^E-Mail/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link anfordern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("schief");
    });
  });

  test("custom title prop overrides default", () => {
    renderWithProviders(<RequestAccountUnlockScreen title="Custom Unlock" />);
    expect(screen.getByText("Custom Unlock")).toBeTruthy();
  });
});
