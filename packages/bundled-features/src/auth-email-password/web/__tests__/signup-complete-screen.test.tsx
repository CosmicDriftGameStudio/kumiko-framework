import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SignupCompleteScreen } from "../signup-complete-screen";
import { renderWithProviders } from "./test-utils";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          user: { id: "u1", tenantId: "t1", roles: ["User"] },
          tenantKey: "acme",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fillPasswords(password: string, confirm: string): void {
  fireEvent.change(document.getElementById("signup-password") as HTMLInputElement, {
    target: { value: password },
  });
  fireEvent.change(document.getElementById("signup-confirm-password") as HTMLInputElement, {
    target: { value: confirm },
  });
}

describe("SignupCompleteScreen", () => {
  test("ohne Token in URL UND ohne token-Prop → missing-token-Page", () => {
    renderWithProviders(<SignupCompleteScreen />);
    expect(screen.getByText(/enthält keinen Token/i)).toBeTruthy();
  });

  test("mit token-Prop → Form rendert", () => {
    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    expect(document.getElementById("signup-password")).toBeTruthy();
    expect(document.getElementById("signup-confirm-password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account aktivieren" })).toBeTruthy();
  });

  test("Passwort < 8 Zeichen → client-side error, kein fetch-Call", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc" />);
    fillPasswords("short", "short");
    fireEvent.click(screen.getByRole("button", { name: "Account aktivieren" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("8 Zeichen");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("happy path: gültiges Passwort → signup-confirm fetch + location.assign", async () => {
    const assigned: string[] = [];
    const assignOrig = window.location.assign.bind(window.location);
    window.location.assign = ((url: string | URL) => {
      assigned.push(String(url));
    }) as typeof window.location.assign;

    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["User"] },
            tenantKey: "acme",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      renderWithProviders(
        <SignupCompleteScreen
          token="abc-token"
          loggedInHref={({ tenantKey }) => `/${tenantKey}/`}
        />,
      );
      fillPasswords("validpass1", "validpass1");
      fireEvent.click(screen.getByRole("button", { name: "Account aktivieren" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/auth/signup-confirm",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ token: "abc-token", password: "validpass1" }),
          }),
        );
        expect(assigned).toEqual(["/acme/"]);
      });
    } finally {
      window.location.assign = assignOrig;
    }
  });

  test("mismatch → client-side error, kein fetch-Call", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc" />);
    fillPasswords("validpass1", "differentpass");
    fireEvent.click(screen.getByRole("button", { name: "Account aktivieren" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht überein");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("server invalid_signup_token → mapped i18n-error im UI", async () => {
    const errBody = JSON.stringify({
      error: { code: "invalid_signup_token", details: { reason: "invalid_signup_token" } },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="bad" />);
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Account aktivieren" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/ungültig|abgelaufen/i);
    });
  });
});
