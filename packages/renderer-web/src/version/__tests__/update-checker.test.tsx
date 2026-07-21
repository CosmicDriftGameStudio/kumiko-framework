// UpdateChecker DOM coverage: fetchServerBuild + banner on id drift.
// shouldShowUpdate/isKumikoBuild stay in update-checker.test.ts (unit).

import { afterEach, describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { render } from "../../__tests__/test-utils";
import { UpdateChecker } from "../update-checker";

const LOADED_BUILD = { id: "build-loaded", builtAt: "2026-01-01T00:00:00Z" };
const originalFetch = globalThis.fetch;

function mockBuildInfoFetch(handler: (url: string) => Promise<Response> | Response): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete window.__KUMIKO_BUILD__;
});

describe("UpdateChecker", () => {
  test("build-info drift → status banner + reload button", async () => {
    window.__KUMIKO_BUILD__ = LOADED_BUILD;
    mockBuildInfoFetch(async (url) => {
      if (url.endsWith("/build-info.json")) {
        return {
          ok: true,
          json: async () => ({ id: "build-server", builtAt: "2026-01-02T00:00:00Z" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeTruthy();
    });
    expect(screen.getByText("A new version is available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("build-info !ok → no banner", async () => {
    window.__KUMIKO_BUILD__ = LOADED_BUILD;
    mockBuildInfoFetch(async (url) => {
      if (url.endsWith("/build-info.json")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("invalid build-info JSON shape → no banner", async () => {
    window.__KUMIKO_BUILD__ = LOADED_BUILD;
    mockBuildInfoFetch(async (url) => {
      if (url.endsWith("/build-info.json")) {
        return { ok: true, json: async () => ({ id: "" }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("broken JSON (parse error) → no banner", async () => {
    window.__KUMIKO_BUILD__ = LOADED_BUILD;
    mockBuildInfoFetch(async (url) => {
      if (url.endsWith("/build-info.json")) {
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("no __KUMIKO_BUILD__ → no fetch, no banner", () => {
    const fetchSpy = mock(async () => ({
      ok: true,
      json: async () => ({ id: "other", builtAt: "" }),
    }));
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    render(<UpdateChecker />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
