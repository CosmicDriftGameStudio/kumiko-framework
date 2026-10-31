import { afterEach, describe, expect, mock, test } from "bun:test";
import { type NavApi, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  isAuthedOnLoginPath,
  useRedirectAuthedFromLogin,
} from "../use-redirect-authed-from-login.ts";
import { makeSessionApi, renderWithProviders } from "./test-utils.tsx";

const TARGET = { workspaceId: "app", screenId: "dashboard" } as const;

function makeNav(replace: NavApi["replace"]): NavApi {
  return {
    route: undefined,
    navigate: () => {},
    replace,
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
}

function Probe(): ReactNode {
  useRedirectAuthedFromLogin({ loginPath: "/login", target: TARGET });
  return null;
}

function mountAt(pathname: string, authed: boolean) {
  window.history.replaceState(null, "", pathname);
  const replace = mock<NavApi["replace"]>(() => {});
  const session = makeSessionApi(authed ? {} : { status: "unauthenticated", user: null });
  renderWithProviders(
    <NavProvider value={makeNav(replace)}>
      <Probe />
    </NavProvider>,
    { session },
  );
  return replace;
}

describe("isAuthedOnLoginPath", () => {
  test("true only when authed and on the login path", () => {
    expect(isAuthedOnLoginPath(true, "/login", "/login")).toBe(true);
    expect(isAuthedOnLoginPath(false, "/login", "/login")).toBe(false);
    expect(isAuthedOnLoginPath(true, "/app", "/login")).toBe(false);
  });
});

describe("useRedirectAuthedFromLogin", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("authed on the login path replaces to the target", () => {
    const replace = mountAt("/login", true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(TARGET);
  });

  test("not authed does not redirect", () => {
    const replace = mountAt("/login", false);
    expect(replace).not.toHaveBeenCalled();
  });

  test("authed on another path does not redirect", () => {
    const replace = mountAt("/app/dashboard", true);
    expect(replace).not.toHaveBeenCalled();
  });

  test("popstate back to the login path redirects again", () => {
    const replace = mountAt("/app/dashboard", true);
    expect(replace).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(null, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(TARGET);
  });
});
