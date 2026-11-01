import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SignupScreen } from "../signup-screen.tsx";
import { renderWithProviders } from "./test-utils.tsx";

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
    expect(screen.getByText("Create account")).toBeTruthy();
    expect(document.getElementById("signup-email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send activation link" })).toBeTruthy();
  });

  test("submit calls /api/auth/signup-request with the email", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send activation link" }));

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

  test("after successful submit: success banner + Resend", async () => {
    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send activation link" }));

    await waitFor(() => {
      expect(screen.getByText("Email sent")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Send email again/i })).toBeTruthy();
  });

  test("rate_limited with retryAfterSeconds → interpolated minutes", async () => {
    const errBody = JSON.stringify({
      error: { code: "rate_limited", details: { retryAfterSeconds: 120 } },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 429 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send activation link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/2/);
    });
    expect(screen.queryByText("Email sent")).toBeNull();
  });

  test("server 5xx → error banner instead of Success state", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupScreen />);
    fillEmail("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send activation link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("wrong");
    });
    expect(screen.queryByText("Email sent")).toBeNull();
  });
});

describe("SignupScreen registration status", () => {
  function statusDispatcher(enabled: boolean): Dispatcher {
    return { query: async () => ({ isSuccess: true, data: { enabled } }) } as unknown as Dispatcher;
  }

  test("enabled: the form shows", async () => {
    renderWithProviders(<SignupScreen />, { dispatcher: statusDispatcher(true) });
    expect(await screen.findByRole("button", { name: "Send activation link" })).toBeTruthy();
  });

  test("disabled: closed notice and login link, no form, nothing is sent", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithProviders(<SignupScreen />, { dispatcher: statusDispatcher(false) });
    expect(await screen.findByText("Sign-up is currently by invitation only.")).toBeTruthy();
    expect(document.getElementById("signup-email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send activation link" })).toBeNull();
    expect(screen.getByRole("link", { name: /Already have an account/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("disabled: closedFallback replaces the notice", async () => {
    renderWithProviders(<SignupScreen closedFallback={<p>Join the waitlist</p>} />, {
      dispatcher: statusDispatcher(false),
    });
    expect(await screen.findByText("Join the waitlist")).toBeTruthy();
    expect(screen.queryByText("Create account")).toBeNull();
    expect(document.getElementById("signup-email")).toBeNull();
  });
});
