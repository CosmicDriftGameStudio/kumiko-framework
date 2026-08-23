import { afterEach, describe, expect, test } from "bun:test";
import { postWithDownload } from "../download";

function stubDispatcher(result: unknown) {
  return { query: async () => result };
}

// Patch only location.assign on happy-dom's real window — swapping the whole
// window object corrupts every later DOM suite in the same bun process.
const originalAssign = window.location.assign.bind(window.location);

describe("postWithDownload", () => {
  afterEach(() => {
    window.location.assign = originalAssign;
  });

  test("assigns the url and returns null on success", async () => {
    let assignedUrl: string | undefined;
    window.location.assign = (u: string) => {
      assignedUrl = u;
    };
    const dispatcher = stubDispatcher({ isSuccess: true, data: { url: "https://cdn.example.com/f.pdf" } });
    const err = await postWithDownload(dispatcher as never, "files.signedUrl", {});
    expect(assignedUrl).toBe("https://cdn.example.com/f.pdf");
  });

  test("passes the dispatcher error through when not successful", async () => {
    const dispatcherError = { code: "boom", httpStatus: 500 };
    const dispatcher = stubDispatcher({ isSuccess: false, error: dispatcherError });
    const err = await postWithDownload(dispatcher as never, "files.signedUrl", {});
    expect(err).toBe(dispatcherError);
  });

  test("returns download_url_missing error when url is absent", async () => {
    const err = await postWithDownload(
      stubDispatcher({ isSuccess: true, data: {} }) as never,
      "files.signedUrl",
      {},
    );
    expect(err).not.toBeNull();
    expect(err?.code).toBe("download_url_missing");
    expect(err?.httpStatus).toBe(502);
    expect(err?.i18nKey).toBe("errors.download.urlMissing");
  });
});
