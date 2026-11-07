import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { renderHtmlToPdf } from "../render-html-to-pdf";
import { installFetchMock } from "./install-fetch-mock";

const AUTH_TOKEN = "test-puppeteer-token";

let originalFetch: typeof globalThis.fetch;
let originalToken: string | undefined;
let originalUrl: string | undefined;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalToken = process.env["PUPPETEER_AUTH_TOKEN"];
  originalUrl = process.env["PUPPETEER_SERVICE_URL"];
  process.env["PUPPETEER_AUTH_TOKEN"] = AUTH_TOKEN;
  process.env["PUPPETEER_SERVICE_URL"] = "http://puppeteer-service:3000";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("PUPPETEER_AUTH_TOKEN", originalToken);
  restoreEnv("PUPPETEER_SERVICE_URL", originalUrl);
});

describe("renderHtmlToPdf", () => {
  test("posts the html as a document-pdf render and returns the bytes", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const fetchMock = mock().mockResolvedValueOnce(
      new Response(pdf.slice(), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    installFetchMock(fetchMock);

    const bytes = await renderHtmlToPdf("<p>x</p>", { format: "A4" });

    expect(bytes).toEqual(pdf);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("http://puppeteer-service:3000/render");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "document-pdf",
      html: "<p>x</p>",
      options: { format: "A4" },
    });
  });

  test("a missing auth token reports the service as unavailable", async () => {
    delete process.env["PUPPETEER_AUTH_TOKEN"];
    const error = await renderHtmlToPdf("<p>x</p>").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RendererError);
  });
});
