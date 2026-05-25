import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createRendererFoundationApi } from "../api";
import { collectRendererPlugins, createRendererFoundationFeature } from "../feature";
import type { RenderRequest, RenderResponse } from "../types";

const TEST_TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;

let stack: TestStack;

// Mini-Plugin via defineFeature + r.useExtension — wie ein echter
// renderer-plugin (renderer-simple, renderer-mail-html) sich registriert.
function createTestPluginFeature(name: string, kinds: ReadonlyArray<string>) {
  return defineFeature(`renderer-${name}`, (r) => {
    r.requires("renderer-foundation");
    r.useExtension("renderer", name, {
      kinds,
      render: async (req: RenderRequest): Promise<RenderResponse> => {
        if (req.kind === "notification") return { kind: "notification", html: `via:${name}` };
        if (req.kind === "mail-html")
          return { kind: "mail-html", html: `via:${name}`, text: `via:${name}` };
        if (req.kind === "document-pdf")
          return {
            kind: "document-pdf",
            pdfBytes: new Uint8Array([1]),
            pageCount: 1,
            sizeBytes: 1,
          };
        return {
          kind: "image-snapshot",
          imageBytes: new Uint8Array([1]),
          format: "png",
          width: 1,
          height: 1,
        };
      },
    });
  });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createTestPluginFeature("simple", ["notification"]),
      createTestPluginFeature("mail-html", ["mail-html"]),
      createTestPluginFeature("puppeteer", ["document-pdf", "image-snapshot"]),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("renderer-foundation :: Plugin-Pool aus Registry", () => {
  test("collectRendererPlugins findet alle registrierten Plugins", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const names = plugins.map((p) => p.name).sort();
    expect(names).toEqual(["mail-html", "puppeteer", "simple"]);
  });

  test("jeder Plugin behält seine kinds-Deklaration", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const byName = new Map(plugins.map((p) => [p.name, p]));
    expect([...byName.get("simple")!.kinds]).toEqual(["notification"]);
    expect([...byName.get("mail-html")!.kinds]).toEqual(["mail-html"]);
    expect([...byName.get("puppeteer")!.kinds].sort()).toEqual(["document-pdf", "image-snapshot"]);
  });

  test("API findet Default-Plugin pro kind aus echtem Pool", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    expect(api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "notification" }).name).toBe(
      "simple",
    );
    expect(api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "mail-html" }).name).toBe(
      "mail-html",
    );
    expect(api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "document-pdf" }).name).toBe(
      "puppeteer",
    );
  });

  test("Plugin.render mit echtem Pool fließt end-to-end durch", async () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    const plugin = api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "notification" });
    const result = await plugin.render(
      { kind: "notification", payload: { content: "hello", contentFormat: "markdown" } },
      { db: stack.db, registry: stack.registry, tenantId: TEST_TENANT },
    );
    expect(result.kind).toBe("notification");
    if (result.kind === "notification") {
      expect(result.html).toBe("via:simple");
    }
  });
});
