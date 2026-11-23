// Chromium-free proof of the per-render isolation and the screenshot timeout in render.ts.

import { describe, expect, test } from "bun:test";
import { TimeoutError } from "puppeteer";
import { browserLaunchOptions, withIsolatedPage, withRenderTimeout } from "../render";

type FakePage = { readonly contextNumber: number };

function createFakeBrowser(opts: { failClose?: boolean } = {}) {
  const state = { contextsCreated: 0, contextsClosed: 0 };
  const browser = {
    async createBrowserContext() {
      state.contextsCreated += 1;
      const contextNumber = state.contextsCreated;
      return {
        async newPage(): Promise<FakePage> {
          return { contextNumber };
        },
        async close(): Promise<void> {
          state.contextsClosed += 1;
          if (opts.failClose) throw new Error("close failed");
        },
      };
    },
  };
  return { browser, state };
}

describe("withIsolatedPage", () => {
  test("each call opens a fresh context, hands its page to the work and closes it", async () => {
    const { browser, state } = createFakeBrowser();
    const first = await withIsolatedPage(browser, async (page) => page.contextNumber);
    const second = await withIsolatedPage(browser, async (page) => page.contextNumber);
    expect(first).not.toBe(second);
    expect(state.contextsCreated).toBe(2);
    expect(state.contextsClosed).toBe(2);
  });

  test("the context is closed when the work throws", async () => {
    const { browser, state } = createFakeBrowser();
    await expect(
      withIsolatedPage(browser, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(state.contextsClosed).toBe(1);
  });

  test("a failing context close does not replace the render result", async () => {
    const { browser } = createFakeBrowser({ failClose: true });
    const result = await withIsolatedPage(browser, async () => "rendered");
    expect(result).toBe("rendered");
  });
});

describe("withRenderTimeout", () => {
  test("rejects a hung step with puppeteer's TimeoutError", async () => {
    await expect(
      withRenderTimeout(new Promise<never>(() => {}), 5, "screenshot"),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  test("passes a finished step through", async () => {
    await expect(withRenderTimeout(Promise.resolve("bytes"), 1_000, "screenshot")).resolves.toBe(
      "bytes",
    );
  });

  test("a late rejection of the losing step stays handled", async () => {
    let rejectWork: (reason: Error) => void = () => {};
    const work = new Promise<never>((_, reject) => {
      rejectWork = reject;
    });
    await expect(withRenderTimeout(work, 5, "screenshot")).rejects.toBeInstanceOf(TimeoutError);
    rejectWork(new Error("page closed"));
    await Promise.resolve();
  });
});

describe("browserLaunchOptions", () => {
  test("passes the env on without the auth token", () => {
    const options = browserLaunchOptions(undefined, {
      PATH: "/usr/bin",
      PUPPETEER_AUTH_TOKEN: "secret-token-0123456789",
    });
    expect(options.env?.["PATH"]).toBe("/usr/bin");
    expect(options.env !== undefined && "PUPPETEER_AUTH_TOKEN" in options.env).toBe(false);
  });

  test("sets executablePath only when defined", () => {
    expect("executablePath" in browserLaunchOptions(undefined, {})).toBe(false);
    expect(browserLaunchOptions("/usr/bin/chromium", {}).executablePath).toBe("/usr/bin/chromium");
  });
});
