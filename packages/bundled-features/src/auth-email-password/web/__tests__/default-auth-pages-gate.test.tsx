import { afterEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { createMockDispatcher } from "@cosmicdrift/kumiko-renderer/testing";
import type { ComponentType, ReactNode } from "react";
import { emailPasswordClient } from "../client-plugin.ts";
import { DefaultAuthPagesGate, makeDefaultAuthPagesGate } from "../default-auth-pages-gate.tsx";
import { installFetchMock } from "./fetch-mock.ts";
import {
  clearCsrfCookie,
  makeSessionApi,
  renderWithProviders,
  setCsrfCookie,
} from "./test-utils.tsx";

installFetchMock();

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

type RenderAtOptions = {
  readonly gate?: ComponentType<{ readonly children: ReactNode }>;
  readonly dispatcher?: Dispatcher;
};

function renderAt(
  path: string,
  basePath?: string,
  options: RenderAtOptions = {},
): ReturnType<typeof renderWithProviders> {
  window.history.replaceState({}, "", path);
  const Gate = options.gate ?? DefaultAuthPagesGate;
  return renderWithProviders(
    <Gate>
      <div data-testid="app">APP</div>
    </Gate>,
    {
      session: makeSessionApi({ status: "unauthenticated", user: null }),
      ...(basePath !== undefined && { basePath }),
      ...(options.dispatcher !== undefined && { dispatcher: options.dispatcher }),
    },
  );
}

function signupStatusDispatcher(enabled: boolean): Dispatcher {
  return createMockDispatcher({ query: async () => ({ isSuccess: true, data: { enabled } }) });
}

function AppForgotGate({ children }: { readonly children: ReactNode }): ReactNode {
  return window.location.pathname === "/forgot-password" ? (
    <div data-testid="app-forgot">APP FORGOT</div>
  ) : (
    children
  );
}

describe("DefaultAuthPagesGate", () => {
  test("/forgot-password shows the framework screen", () => {
    const ui = renderAt("/forgot-password");
    expect(ui.queryByTestId("app")).toBeNull();
    expect(ui.getByLabelText(/^Email/)).toBeTruthy();
  });

  test("/unlock-account without token requests, with token confirms", () => {
    const request = renderAt("/unlock-account");
    expect(request.getByLabelText(/^Email/)).toBeTruthy();
    request.unmount();
    const confirm = renderAt("/unlock-account?token=abc");
    expect(confirm.queryByLabelText(/^Email/)).toBeNull();
    expect(confirm.queryByTestId("app")).toBeNull();
  });

  test("/reset-password needs a token, otherwise the app renders", () => {
    expect(renderAt("/reset-password").getByTestId("app")).toBeTruthy();
  });

  test("an app mounted under a base path matches the auth pages below it", () => {
    const unlock = renderAt("/admin/unlock-account?token=abc", "/admin");
    expect(unlock.queryByTestId("app")).toBeNull();
    unlock.unmount();
    const forgot = renderAt("/admin/forgot-password", "/admin");
    expect(forgot.queryByTestId("app")).toBeNull();
    expect(forgot.getByLabelText(/^Email/)).toBeTruthy();
  });

  test("under a base path the unprefixed auth paths belong to the host, not the app", () => {
    expect(renderAt("/forgot-password", "/admin").getByTestId("app")).toBeTruthy();
  });

  test("other paths pass through", () => {
    expect(renderAt("/dashboard").getByTestId("app")).toBeTruthy();
  });

  test("an app gate listed before emailPasswordClient wins on the same path", () => {
    window.history.replaceState({}, "", "/forgot-password");
    const frameworkGates = emailPasswordClient().gates;
    const [DefaultPages, SessionGate] = frameworkGates;
    if (!DefaultPages || !SessionGate) throw new Error("expected two gates");
    const stacked = (
      <AppForgotGate>
        <DefaultPages>
          <SessionGate>
            <div data-testid="app">APP</div>
          </SessionGate>
        </DefaultPages>
      </AppForgotGate>
    );
    const { getByTestId, queryByLabelText } = render(stacked);
    expect(getByTestId("app-forgot")).toBeTruthy();
    expect(queryByLabelText(/^Email/)).toBeNull();
  });

  test("defaultAuthPages: false drops the gate", () => {
    expect(emailPasswordClient({ defaultAuthPages: false }).gates).toHaveLength(1);
    expect(emailPasswordClient().gates).toHaveLength(2);
    expect(emailPasswordClient({ defaultAuthPages: { paths: {} } }).gates).toHaveLength(2);
  });

  test.each([
    "/verify-email?token=abc",
    "/signup/complete?token=abc",
    "/invite/accept?token=abc",
  ])("%s shows a framework screen, not the app", (path) => {
    expect(renderAt(path).queryByTestId("app")).toBeNull();
  });

  test("/signup without a dispatcher shows the form", () => {
    const ui = renderAt("/signup");
    expect(ui.queryByTestId("app")).toBeNull();
    expect(ui.getByLabelText(/^Email/)).toBeTruthy();
  });

  test("/signup with an open registration status shows the form", async () => {
    const ui = renderAt("/signup", undefined, { dispatcher: signupStatusDispatcher(true) });
    expect(await ui.findByLabelText(/^Email/)).toBeTruthy();
    expect(ui.queryByTestId("app")).toBeNull();
  });

  test("/signup falls through to the app when the server has no signup query", async () => {
    const failing = createMockDispatcher({
      query: async () => ({
        isSuccess: false,
        error: {
          code: "not_found",
          httpStatus: 404,
          i18nKey: "errors.notFound",
          message: "unknown query",
        },
      }),
    });
    const ui = renderAt("/signup", undefined, { dispatcher: failing });
    expect(await ui.findByTestId("app")).toBeTruthy();
  });

  test("/signup with a session cookie falls through to the app", () => {
    setCsrfCookie("x");
    try {
      expect(renderAt("/signup").getByTestId("app")).toBeTruthy();
    } finally {
      clearCsrfCookie();
    }
  });

  test("custom paths are served at the custom path only", () => {
    const gate = makeDefaultAuthPagesGate({ paths: { resetPassword: "/de/passwort-neu" } });
    const custom = renderAt("/de/passwort-neu?token=abc", undefined, { gate });
    expect(custom.queryByTestId("app")).toBeNull();
    custom.unmount();
    const plain = renderAt("/reset-password?token=abc", undefined, { gate });
    expect(plain.getByTestId("app")).toBeTruthy();
  });

  test("a function path is resolved with the current locale", () => {
    const gate = makeDefaultAuthPagesGate({
      paths: { resetPassword: (locale) => `/${locale}/reset` },
    });
    expect(renderAt("/en/reset?token=abc", undefined, { gate }).queryByTestId("app")).toBeNull();
  });

  test("the login link points under the app base path", () => {
    const ui = renderAt("/app/forgot-password", "/app");
    expect(ui.getByRole("link", { name: /sign in|back to/i }).getAttribute("href")).toBe(
      "/app/login",
    );
  });
});
