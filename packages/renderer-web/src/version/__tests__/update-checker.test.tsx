// UpdateChecker DOM coverage: fetchServerBuild + banner on id drift.
// shouldShowUpdate/isKumikoBuild stay in update-checker.test.ts (unit).

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, screen, waitFor } from "@testing-library/react";
import { render } from "../../__tests__/test-utils.js";
import { UpdateChecker } from "../update-checker.js";

const LOADED_BUILD = { id: "build-loaded", builtAt: "2026-01-01T00:00:00Z" };
const originalFetch = globalThis.fetch;

function setLoadedBuildMeta(build: { id: string; builtAt: string }): void {
  const meta = document.createElement("meta");
  meta.name = "kumiko-build";
  meta.content = build.id;
  meta.dataset["builtAt"] = build.builtAt;
  document.head.append(meta);
}

function mockBuildInfoFetch(handler: (url: string) => Promise<Response> | Response): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.querySelector('meta[name="kumiko-build"]')?.remove();
});

describe("UpdateChecker", () => {
  test("build-info drift → status banner + reload button", async () => {
    setLoadedBuildMeta(LOADED_BUILD);
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
    setLoadedBuildMeta(LOADED_BUILD);
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
    setLoadedBuildMeta(LOADED_BUILD);
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
    setLoadedBuildMeta(LOADED_BUILD);
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

  test("no kumiko-build meta → no fetch, no banner", async () => {
    const fetchSpy = mock(async () => ({
      ok: true,
      json: async () => ({ id: "other", builtAt: "" }),
    }));
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    render(<UpdateChecker />);
    await act(async () => {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
