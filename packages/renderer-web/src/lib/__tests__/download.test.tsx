// happy-dom coverage for postWithDownload's window.location.assign path.
// bunfig.toml (unit `test`) ignores *.test.tsx; bunfig.dom.toml picks this up.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Dispatcher, QueryResult } from "@cosmicdrift/kumiko-headless";
import { postWithDownload } from "../download";

function stubDispatcher(result: QueryResult<{ url?: string }>): Dispatcher {
  return { query: async () => result } as unknown as Dispatcher;
}

describe("postWithDownload (happy-dom)", () => {
  let assignSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    assignSpy?.mockRestore();
    assignSpy = undefined;
  });

  test("assigns the url on the real window", async () => {
    assignSpy = spyOn(window.location, "assign").mockImplementation(() => {});
    const err = await postWithDownload(
      stubDispatcher({ isSuccess: true, data: { url: "https://cdn.example.com/f.pdf" } }),
      "files.signedUrl",
      {},
    );
    expect(err).toBeNull();
    expect(assignSpy).toHaveBeenCalledWith("https://cdn.example.com/f.pdf");
  });
});
