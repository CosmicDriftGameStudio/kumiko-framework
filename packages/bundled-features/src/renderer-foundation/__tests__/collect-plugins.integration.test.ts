import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { createRendererFoundationApi } from "../api.ts";
import { RENDERER_EXTENSION, type RenderKind } from "../constants.ts";
import { collectRendererPlugins, createRendererFoundationFeature } from "../feature.ts";
import type { RenderRequest, RenderResponse } from "../types.ts";

const TEST_TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;

let stack: TestStack;

// Mini-Plugin via defineFeature + r.useExtension — wie ein echter
// renderer-plugin (renderer-mail-html, renderer-puppeteer-client) sich registriert.
function createTestPluginFeature(name: string, kinds: ReadonlyArray<RenderKind>) {
  return defineFeature(`renderer-${name}`, (r) => {
    r.requires({ features: ["renderer-foundation"] });
    r.useExtension(RENDERER_EXTENSION, name, {
      kinds,
      render: async (req: RenderRequest): Promise<RenderResponse> => {
        if (req.kind === "mail")
          return { kind: "mail", subject: name, html: `via:${name}`, text: `via:${name}` };
        if (req.kind === "document-pdf")
          return {
            kind: "document-pdf",
            pdfBytes: new Uint8Array([1]),
            pageCount: 1,
            sizeBytes: 1,
            fileName: "x.pdf",
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
      createTestPluginFeature("mail-html", ["mail"]),
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
    expect(names).toEqual(["mail-html", "puppeteer"]);
  });

  test("jeder Plugin behält seine kinds-Deklaration", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const byName = new Map(plugins.map((p) => [p.name, p]));
    expect([...byName.get("mail-html")!.kinds]).toEqual(["mail"]);
    expect([...byName.get("puppeteer")!.kinds].sort()).toEqual(["document-pdf", "image-snapshot"]);
  });

  test("API findet Default-Plugin pro kind aus echtem Pool", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    expect(api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "mail" }).name).toBe(
      "mail-html",
    );
    expect(api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "document-pdf" }).name).toBe(
      "puppeteer",
    );
  });

  test("collectRendererPlugins fails loud on a registration with invalid options", async () => {
    const brokenStack = await setupTestStack({
      features: [
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        defineFeature("renderer-broken", (r) => {
          r.requires({ features: ["renderer-foundation"] });
          // @ts-expect-error kinds/render are required — proves the guard rejects an empty options bag instead of silently dropping the plugin
          r.useExtension(RENDERER_EXTENSION, "broken", {});
        }),
      ],
    });
    try {
      expect(() => collectRendererPlugins(brokenStack.registry)).toThrow(
        `${RENDERER_EXTENSION} registration for "broken" has invalid options`,
      );
    } finally {
      await brokenStack.cleanup();
    }
  });

  test("Plugin.render mit echtem Pool fließt end-to-end durch", async () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    const plugin = api.createRendererForTenant({ tenantId: TEST_TENANT, kind: "mail" });
    const result = await plugin.render(
      { kind: "mail", payload: { slug: "welcome", locale: "en", variables: {} } },
      { db: stack.db, registry: stack.registry, tenantId: TEST_TENANT },
    );
    expect(result.kind).toBe("mail");
    if (result.kind === "mail") {
      expect(result.html).toBe("via:mail-html");
    }
  });
});
