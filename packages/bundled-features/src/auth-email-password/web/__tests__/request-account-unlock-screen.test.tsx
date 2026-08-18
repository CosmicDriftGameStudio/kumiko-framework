import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { RequestAccountUnlockScreen } from "../request-account-unlock-screen";
import { installFetchMock } from "./fetch-mock";
import { renderWithProviders } from "./test-utils";

installFetchMock();

describe("RequestAccountUnlockScreen", () => {
  test("renders title + email input + submit (de)", () => {
    renderWithProviders(<RequestAccountUnlockScreen />);
    expect(screen.getByText("Unlock account")).toBeTruthy();
    expect(screen.getByLabelText(/^Email/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request link" })).toBeTruthy();
  });

  test("submit posts /api/auth/request-account-unlock with email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/request-account-unlock",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          credentials: "same-origin",
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
    });
  });

  test("success → silent-success banner + back-to-login link", async () => {
    renderWithProviders(<RequestAccountUnlockScreen loginHref="/signin" />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByText("Email sent")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Back to sign in/i }).getAttribute("href")).toBe(
      "/signin",
    );
  });

  test("429 with retryAfterSeconds → requestUnlock.rateLimited banner (#1333)", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: { details: { retryAfterSeconds: 180 } } }), {
          status: 429,
        }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("3 minutes");
    });
    expect(screen.queryByText("Email sent")).toBeNull();
  });

  test("429 without retryAfterSeconds → generic rateLimited banner", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Too many login attempts");
    });
  });

  test("server 5xx → unknownError banner, stays on form", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("wrong");
    });
    expect(screen.queryByText("Email sent")).toBeNull();
    expect(screen.getByLabelText(/^Email/)).toBeTruthy();
  });

  test("fetch throw → unknownError banner", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    renderWithProviders(<RequestAccountUnlockScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("wrong");
    });
  });

  test("custom title prop overrides default", () => {
    renderWithProviders(<RequestAccountUnlockScreen title="Custom Unlock" />);
    expect(screen.getByText("Custom Unlock")).toBeTruthy();
  });
});
