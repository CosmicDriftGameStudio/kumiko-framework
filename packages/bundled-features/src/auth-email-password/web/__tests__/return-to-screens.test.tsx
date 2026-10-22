import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ForgotPasswordScreen } from "../forgot-password-screen.tsx";
import { LoginScreen } from "../login-screen.tsx";
import { ResetPasswordScreen } from "../reset-password-screen.tsx";
import { SignupCompleteScreen } from "../signup-complete-screen.tsx";
import { SignupScreen } from "../signup-screen.tsx";
import { installFetchMock } from "./fetch-mock.ts";
import { renderWithProviders } from "./test-utils.tsx";

const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});
installFetchMock();

function openPage(search: string): void {
  window.history.replaceState(null, "", `http://localhost/page${search}`);
}

function stubFetch(response: () => Response) {
  const fetchMock = mock(async () => response());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function lastRequestBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, { body: string }] | undefined;
  return JSON.parse(call?.[1].body ?? "null");
}

afterEach(() => {
  openPage("");
});

describe("ForgotPasswordScreen returnTo", () => {
  test("sends a safe returnTo from the page URL with the request", async () => {
    openPage("?returnTo=%2Fa%2Fsettings");
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody(fetchMock)).toEqual({
      email: "user@example.com",
      returnTo: "/a/settings",
    });
  });

  test("does not send an unsafe returnTo", async () => {
    openPage("?returnTo=%2F%2Fevil.example");
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));

    renderWithProviders(<ForgotPasswordScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody(fetchMock)).toEqual({ email: "user@example.com" });
  });
});

describe("SignupScreen returnTo", () => {
  test("sends a safe returnTo from the page URL with the request", async () => {
    openPage("?returnTo=%2Fa%2Fstart");
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));

    renderWithProviders(<SignupScreen />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send|Sign up|Continue|Create|Register/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody(fetchMock)).toEqual({ email: "new@example.com", returnTo: "/a/start" });
  });
});

describe("ResetPasswordScreen returnTo", () => {
  test("after success the login link carries the returnTo as next", async () => {
    openPage("?returnTo=%2Fa%2Fsettings");
    stubFetch(() => new Response(null, { status: 200 }));

    renderWithProviders(<ResetPasswordScreen token="url-independent-token" />);
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "validpass1" } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), {
      target: { value: "validpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(screen.getByText("Password set")).toBeTruthy());
    expect(screen.getByRole("link").getAttribute("href")).toBe("/login?next=%2Fa%2Fsettings");
  });

  test("an unsafe returnTo leaves the login link plain", async () => {
    openPage("?returnTo=https%3A%2F%2Fevil.example");
    stubFetch(() => new Response(null, { status: 200 }));

    renderWithProviders(<ResetPasswordScreen token="url-independent-token" />);
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "validpass1" } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), {
      target: { value: "validpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(screen.getByText("Password set")).toBeTruthy());
    expect(screen.getByRole("link").getAttribute("href")).toBe("/login");
  });
});

describe("SignupCompleteScreen returnTo", () => {
  const confirmResponse = () =>
    new Response(
      JSON.stringify({
        user: { id: "u1", tenantId: "t1", roles: ["User"] },
        tenantKey: "acme",
        landingPath: "/acme/start",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  async function activate(): Promise<void> {
    fireEvent.change(document.getElementById("signup-password") as HTMLInputElement, {
      target: { value: "validpass1" },
    });
    fireEvent.change(document.getElementById("signup-confirm-password") as HTMLInputElement, {
      target: { value: "validpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Continue" })).toBeTruthy());
  }

  test("a safe returnTo wins over the server landing path", async () => {
    openPage("?returnTo=%2Fa%2Fstart");
    stubFetch(confirmResponse);

    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    await activate();

    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/a/start");
  });

  test("a claimed handover keeps the app target over returnTo", async () => {
    openPage("?returnTo=%2Fa%2Fstart");
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            user: { id: "u1", tenantId: "t1", roles: ["User"] },
            tenantKey: "acme",
            handover: { entityType: "run", id: "run-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    renderWithProviders(
      <SignupCompleteScreen
        token="abc-token"
        loggedInHref={({ tenantKey, handover }) =>
          handover !== undefined ? `/${tenantKey}/${handover.entityType}/${handover.id}` : "/"
        }
      />,
    );
    await activate();

    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
      "/acme/run/run-1",
    );
  });

  test("an unsafe returnTo falls back to the landing path", async () => {
    openPage("?returnTo=%2F%2Fevil.example");
    stubFetch(confirmResponse);

    renderWithProviders(<SignupCompleteScreen token="abc-token" />);
    await activate();

    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/acme/start");
  });
});

describe("LoginScreen returnTo", () => {
  test("a safe next rides along on the forgot-password and signup links", () => {
    openPage("?next=%2Fa%2Fsettings");

    renderWithProviders(<LoginScreen forgotPasswordHref="/forgot-password" signupHref="/signup" />);

    expect(screen.getByRole("link", { name: /Forgot password/i }).getAttribute("href")).toBe(
      "/forgot-password?returnTo=%2Fa%2Fsettings",
    );
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("href")).toBe(
      "/signup?returnTo=%2Fa%2Fsettings",
    );
  });

  test("an unsafe next is not passed on", () => {
    openPage("?next=%2F%2Fevil.example");

    renderWithProviders(<LoginScreen forgotPasswordHref="/forgot-password" signupHref="/signup" />);

    expect(screen.getByRole("link", { name: /Forgot password/i }).getAttribute("href")).toBe(
      "/forgot-password",
    );
  });
});
