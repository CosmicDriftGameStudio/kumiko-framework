import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useUrlToken } from "../auth-form-primitives";

// #774: magic-link tokens must not linger in browser history / Referer.
// useUrlToken reads the token once, then scrubs the param via replaceState.
// (dom.preload resets window.location to http://localhost/ after each test.)
describe("useUrlToken (magic-link history hygiene)", () => {
  test("reads ?token= and strips it from the URL, keeping other params", () => {
    window.history.replaceState(null, "", "http://localhost/reset?token=secret-abc&keep=1");
    const { result } = renderHook(() => useUrlToken());
    expect(result.current).toBe("secret-abc");
    expect(window.location.search).toBe("?keep=1");
  });

  test("no token param → URL untouched", () => {
    window.history.replaceState(null, "", "http://localhost/reset?keep=1");
    const { result } = renderHook(() => useUrlToken());
    expect(result.current).toBe("");
    expect(window.location.search).toBe("?keep=1");
  });

  test("explicit override short-circuits both URL read and scrub", () => {
    window.history.replaceState(null, "", "http://localhost/reset?token=url-token");
    const { result } = renderHook(() => useUrlToken("prop-token"));
    expect(result.current).toBe("prop-token");
    expect(window.location.search).toBe("?token=url-token");
  });
});
