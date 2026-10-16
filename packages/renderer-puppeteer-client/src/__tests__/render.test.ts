// render function tests via fetch mock. We want to verify request mapping +
// response mapping (RenderRequest → HTTP → RenderResponse).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type RendererContext,
  RendererError,
  type RenderRequest,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { puppeteerRender } from "../render";
import { installFetchMock } from "./install-fetch-mock";

const TENANT: TenantId = "11111111-1111-4111-8111-111111111111" as TenantId;
const STUB_CTX = { db: null, registry: null, tenantId: TENANT } as unknown as RendererContext;

const AUTH_TOKEN = "0123456789abcdef0123456789abcdef";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env["PUPPETEER_AUTH_TOKEN"] = AUTH_TOKEN;
  process.env["PUPPETEER_SERVICE_URL"] = "http://test:3000";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env["PUPPETEER_AUTH_TOKEN"];
  delete process.env["PUPPETEER_SERVICE_URL"];
});

function mockPngResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

describe("puppeteerRender — image-snapshot", () => {
  test("PNG-response mapped to kind=image-snapshot, format=png", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    installFetchMock(mock().mockResolvedValueOnce(mockPngResponse(pngBytes)));
    const result = await puppeteerRender(
      {
        kind: "image-snapshot",
        payload: { content: "<div>x</div>" },
        options: { width: 800, height: 600 },
      },
      STUB_CTX,
    );
    expect(result.kind).toBe("image-snapshot");
    if (result.kind === "image-snapshot") {
      expect(result.format).toBe("png");
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.imageBytes).toEqual(pngBytes);
    }
  });
});

describe("puppeteerRender — Validation", () => {
  test("wrong kind (mail) → RendererError invalid_payload", async () => {
    const req: RenderRequest = {
      kind: "mail",
      payload: { slug: "x", locale: "en", variables: {} },
    };
    await expect(puppeteerRender(req, STUB_CTX)).rejects.toThrow(RendererError);
  });

  test("empty content → RendererError invalid_payload", async () => {
    const req: RenderRequest = {
      kind: "image-snapshot",
      payload: { content: "" },
    };
    await expect(puppeteerRender(req, STUB_CTX)).rejects.toThrow(/required/);
  });

  test("missing auth token → RendererError unavailable with the config message", async () => {
    delete process.env["PUPPETEER_AUTH_TOKEN"];
    const req: RenderRequest = {
      kind: "document-pdf",
      payload: { slug: "invoice", locale: "de", variables: {} },
    };
    await expect(puppeteerRender(req, STUB_CTX)).rejects.toMatchObject({
      name: RendererError.name,
      code: "unavailable",
      message: expect.stringContaining("PUPPETEER_AUTH_TOKEN"),
    });
  });
});
