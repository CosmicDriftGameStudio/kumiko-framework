import { afterEach, describe, expect, test } from "bun:test";
import { postWithDownload } from "../download";

function stubDispatcher(result: unknown) {
  return { query: async () => result };
}

// Works in both bunfig (node) and bunfig.dom.toml (happy-dom) runs:
// - node env: install a minimal fake window for the duration of the test,
//   then remove it again so later suites are unaffected.
// - dom env: patch only location.assign on the real window — swapping the
//   whole window object corrupts every later DOM suite in the same process.
function trackAssignedUrl(): { url: () => string | undefined; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = typeof g.window !== "undefined";
  if (!hadWindow) {
    g.window = { location: { assign(_url: string) {} } };
  }
  const win = g.window as { location: { assign: (u: string) => void } };
  const originalAssign = win.location.assign;
  let assignedUrl: string | undefined;
  win.location.assign = (u: string) => {
    assignedUrl = u;
  };
  return {
    url: () => assignedUrl,
    restore: () => {
      if (hadWindow) {
        win.location.assign = originalAssign;
      } else {
        delete g.window;
      }
    },
  };
}

describe("postWithDownload", () => {
  let tracked: ReturnType<typeof trackAssignedUrl> | undefined;
  afterEach(() => {
    tracked?.restore();
    tracked = undefined;
  });

  test("assigns the url and returns null on success", async () => {
    tracked = trackAssignedUrl();
    const dispatcher = stubDispatcher({ isSuccess: true, data: { url: "https://cdn.example.com/f.pdf" } });
    const err = await postWithDownload(dispatcher as never, "files.signedUrl", {});
    expect(err).toBeNull();
    expect(tracked.url()).toBe("https://cdn.example.com/f.pdf");
  });

  test("passes the dispatcher error through when not successful", async () => {
    const dispatcherError = { code: "boom", httpStatus: 500 };
    const dispatcher = stubDispatcher({ isSuccess: false, error: dispatcherError });
    const err = await postWithDownload(dispatcher as never, "files.signedUrl", {});
    expect(err).toEqual(dispatcherError);
  });

  test("returns download_url_missing error when url is absent", async () => {
    const err = await postWithDownload(
      stubDispatcher({ isSuccess: true, data: {} }) as never,
      "files.signedUrl",
      {},
    );
    expect(err).not.toBeNull();
  });
});
