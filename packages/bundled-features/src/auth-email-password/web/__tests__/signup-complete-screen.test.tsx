import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SignupCompleteScreen } from "../signup-complete-screen.tsx";
import { renderWithProviders } from "./test-utils.tsx";

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
  test("without a token in the URL and without a token prop → missing-token page", () => {
    renderWithProviders(<SignupCompleteScreen />);
    expect(screen.getByText(/missing a token/i)).toBeTruthy();
  });

  test("with token prop → form renders", () => {
    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    expect(document.getElementById("signup-password")).toBeTruthy();
    expect(document.getElementById("signup-confirm-password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate account" })).toBeTruthy();
  });

  test("Password < 8 characters → client-side error, no fetch call", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc" />);
    fillPasswords("short", "short");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("8 characters");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("happy path: valid password → confirmation instead of immediate redirect, Continue button targets resolveLoggedInHref", async () => {
    const assignMock = mock((_url: string | URL): void => {});
    const assignOrig = window.location.assign.bind(window.location);
    window.location.assign = assignMock as typeof window.location.assign;

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
      fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/auth/signup-confirm",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ token: "abc-token", password: "validpass1" }),
          }),
        );
        expect(screen.getByText("Your account is active and you're signed in.")).toBeTruthy();
      });

      // No automatic redirect: the form is gone, but nothing navigated us away.
      expect(assignMock).not.toHaveBeenCalled();

      // Continue button targets exactly what resolveLoggedInHref computes from
      // the response's tenantKey, via the app-supplied function-form prop.
      const continueLink = screen.getByRole("link", { name: "Continue" });
      expect(continueLink.getAttribute("href")).toBe("/acme/");
    } finally {
      window.location.assign = assignOrig;
    }
  });

  test("MFA-pending: Continue leads to login with the signup landing path as next", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            isSuccess: true,
            mfaSetupRequired: true,
            preauthSetupToken: "setup-token",
            landingPath: "/acme/start",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/login?next=%2Facme%2Fstart",
      );
    });
  });

  test("MFA-pending without landing path: Continue leads to bare login", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ isSuccess: true, mfaSetupRequired: true, preauthSetupToken: "t" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/login");
    });
  });

  test("loggedInHref function receives the roles from the signup-confirm response", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["Dealer"] },
            tenantKey: "acme",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loggedInHref={({ tenantKey, roles }) =>
          roles.includes("SystemAdmin") ? "/a/waitlist-list" : `/${tenantKey}/vehicle-start`
        }
      />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/acme/vehicle-start",
      );
    });
  });

  test("gleiche Function, SystemAdmin-Rolle → anderes Ziel", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["SystemAdmin"] },
            tenantKey: "acme",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loggedInHref={({ tenantKey, roles }) =>
          roles.includes("SystemAdmin") ? "/a/waitlist-list" : `/${tenantKey}/vehicle-start`
        }
      />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/a/waitlist-list",
      );
    });
  });

  test("String form remains valid unchanged and ignores the roles", async () => {
    renderWithProviders(<SignupCompleteScreen token="abc-token" loggedInHref="/fixed-landing" />);
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/fixed-landing",
      );
    });
  });

  test("confirm response with handover → loggedInHref function receives handover", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["User"] },
            tenantKey: "acme",
            handover: { entityType: "run", id: "run-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loggedInHref={({ tenantKey, handover }) =>
          handover !== undefined
            ? `/${tenantKey}/${handover.entityType}/${handover.id}`
            : `/${tenantKey}/`
        }
      />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/acme/run/run-1",
      );
    });
  });

  test("confirm response without handover → loggedInHref function receives arguments without the handover key", async () => {
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

    let receivedArgs:
      | { tenantKey: string; roles: readonly string[]; handover?: unknown }
      | undefined;
    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loggedInHref={(args) => {
          receivedArgs = args;
          return `/${args.tenantKey}/`;
        }}
      />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/acme/");
    });
    expect(receivedArgs).toStrictEqual({ tenantKey: "acme", roles: ["User"] });
  });

  test("server landingPath takes precedence over loggedInHref", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["User"] },
            tenantKey: "acme",
            landingPath: "/a/vehicle-create",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <SignupCompleteScreen token="abc-token" loggedInHref={({ tenantKey }) => `/${tenantKey}/`} />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
        "/a/vehicle-create",
      );
    });
  });

  test("Server responds mfaSetupRequired → activation notice without a session, Continue leads to login", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ isSuccess: true, mfaSetupRequired: true, preauthSetupToken: "p" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loginHref="/sign-in"
        loggedInHref={({ tenantKey }) => `/${tenantKey}/`}
      />,
    );
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(
        screen.getByText("Your account is active. Sign in to set up two-factor authentication."),
      ).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/sign-in");
  });

  test("mismatch → client-side error, no fetch call", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="abc" />);
    fillPasswords("validpass1", "differentpass");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("do not match");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("server invalid_signup_token → mapped i18n-error in the UI", async () => {
    const errBody = JSON.stringify({
      error: { code: "invalid_signup_token", details: { reason: "invalid_signup_token" } },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<SignupCompleteScreen token="bad" />);
    fillPasswords("validpass1", "validpass1");
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/invalid|expired/i);
    });
    // Error path stays on the form — no confirmation, no continue link.
    expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
    expect(document.getElementById("signup-password")).toBeTruthy();
  });
});
