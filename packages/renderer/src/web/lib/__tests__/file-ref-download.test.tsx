// happy-dom coverage (anchor, object URLs); picked up by bunfig.dom.toml only.

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import {
  downloadFileRef,
  FileDownloadFailedError,
  fileNameFromContentDisposition,
  saveBlobAsFile,
} from "../file-ref-download.ts";

describe("fileNameFromContentDisposition", () => {
  test("prefers the decoded filename* form", () => {
    expect(
      fileNameFromContentDisposition(
        `attachment; filename="Rechnung.pdf"; filename*=UTF-8''Rechnung%20%C3%9Cber.pdf`,
      ),
    ).toBe("Rechnung Über.pdf");
  });

  test("reads the plain quoted filename", () => {
    expect(fileNameFromContentDisposition(`attachment; filename="a b.pdf"`)).toBe("a b.pdf");
  });

  test("falls back to filename when filename* is malformed", () => {
    expect(
      fileNameFromContentDisposition(`attachment; filename="plain.pdf"; filename*=UTF-8''%E0%A4%A`),
    ).toBe("plain.pdf");
  });

  test("returns undefined without header or filename", () => {
    expect(fileNameFromContentDisposition(null)).toBeUndefined();
    expect(fileNameFromContentDisposition("attachment")).toBeUndefined();
  });
});

describe("saveBlobAsFile and downloadFileRef (happy-dom)", () => {
  const realFetch = globalThis.fetch;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = realFetch;
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  function captureDownloads() {
    const created: Blob[] = [];
    const clicked: Array<{ download: string; href: string }> = [];
    const createUrl = spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return "blob:test-1";
    });
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
    spies.push(createUrl, revoke, click);
    return { created, clicked, revoke };
  }

  function stubFetch(response: Response): void {
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
  }

  test("clicks an anchor with the download attribute and revokes the object URL only after a delay", () => {
    const { clicked, revoke } = captureDownloads();
    saveBlobAsFile("export.csv", new Blob(["a;b"]));
    expect(clicked).toEqual([{ download: "export.csv", href: "blob:test-1" }]);
    expect(revoke).not.toHaveBeenCalled();
    jest.advanceTimersByTime(40_000);
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  test("revokes the object URL even when click throws", () => {
    const { revoke } = captureDownloads();
    spies.push(
      spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
        throw new Error("blocked");
      }),
    );
    expect(() => saveBlobAsFile("x.csv", new Blob(["x"]))).toThrow("blocked");
    jest.advanceTimersByTime(40_000);
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
  });

  test("prepends a UTF-8 BOM on request", async () => {
    const { created } = captureDownloads();
    saveBlobAsFile("x.csv", new Blob(["abc"]), { bom: true });
    const bytes = new Uint8Array(await (created[0] ?? new Blob()).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  test("server file name wins over the fallback", async () => {
    const { clicked } = captureDownloads();
    stubFetch(
      new Response("data", {
        headers: { "content-disposition": `attachment; filename="server.pdf"` },
      }),
    );
    await downloadFileRef("ref-1", { fileName: "fallback.pdf" });
    expect(clicked[0]?.download).toBe("server.pdf");
  });

  test("fallback name applies without a header, then the id", async () => {
    const { clicked } = captureDownloads();
    stubFetch(new Response("data"));
    await downloadFileRef("ref-1", { fileName: "fallback.pdf" });
    stubFetch(new Response("data"));
    await downloadFileRef("ref-2");
    expect(clicked.map((c) => c.download)).toEqual(["fallback.pdf", "ref-2"]);
  });

  test("404 throws FileDownloadFailedError with the status", async () => {
    captureDownloads();
    stubFetch(new Response("nope", { status: 404 }));
    const err = await downloadFileRef("missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileDownloadFailedError);
    expect((err as FileDownloadFailedError).status).toBe(404);
  });
});
