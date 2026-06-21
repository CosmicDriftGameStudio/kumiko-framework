import { describe, expect, spyOn, test } from "bun:test";
import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";
import { postWithDownload } from "../lib/download";

function dispatcherReturning(result: unknown): Dispatcher {
  return { query: async () => result } as unknown as Dispatcher; // @cast-boundary test-stub
}

describe("postWithDownload", () => {
  test("success: navigates to the returned signed URL, returns null", async () => {
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    const url = "https://store.example/export.zip?sig=abc";
    const err = await postWithDownload(
      dispatcherReturning({ isSuccess: true, data: { url } }),
      "f:query:download-by-job",
      { jobId: "j1" },
    );
    expect(err).toBeNull();
    expect(assign).toHaveBeenCalledWith(url);
    assign.mockRestore();
  });

  test("query failure: returns the dispatcher error, no navigation", async () => {
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    const error: DispatcherError = {
      code: "not_found",
      httpStatus: 404,
      i18nKey: "userDataRights.errors.download.notFound",
      message: "nope",
    };
    const err = await postWithDownload(
      dispatcherReturning({ isSuccess: false, error }),
      "f:query:download-by-job",
      { jobId: "j1" },
    );
    expect(err).toEqual(error);
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  test("success but no url: returns synthetic error, no navigation", async () => {
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    const err = await postWithDownload(
      dispatcherReturning({ isSuccess: true, data: {} }),
      "f:query:download-by-job",
      { jobId: "j1" },
    );
    expect(err?.code).toBe("download_url_missing");
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });
});
