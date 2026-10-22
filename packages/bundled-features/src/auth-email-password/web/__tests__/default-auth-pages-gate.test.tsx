import { afterEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { emailPasswordClient } from "../client-plugin.ts";
import { DefaultAuthPagesGate } from "../default-auth-pages-gate.tsx";
import { installFetchMock } from "./fetch-mock.ts";
import { makeSessionApi, renderWithProviders } from "./test-utils.tsx";

installFetchMock();

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function renderAt(path: string, basePath?: string): ReturnType<typeof renderWithProviders> {
  window.history.replaceState({}, "", path);
  return renderWithProviders(
    <DefaultAuthPagesGate>
      <div data-testid="app">APP</div>
    </DefaultAuthPagesGate>,
    {
      session: makeSessionApi({ status: "unauthenticated", user: null }),
      ...(basePath !== undefined && { basePath }),
    },
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
    function AppForgotGate({ children }: { readonly children: ReactNode }): ReactNode {
      return window.location.pathname === "/forgot-password" ? (
        <div data-testid="app-forgot">APP FORGOT</div>
      ) : (
        <>{children}</>
      );
    }
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
  });
});
