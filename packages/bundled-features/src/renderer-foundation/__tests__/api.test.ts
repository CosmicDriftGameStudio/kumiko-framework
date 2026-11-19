import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { selectRendererPlugin } from "../api.ts";
import {
  type RendererContext,
  RendererError,
  type RendererPlugin,
  type RenderRequest,
  type RenderResponse,
} from "../types.ts";

// Stub context for plugin render calls in unit tests. makePlugin ignores
// ctx; db and registry are null-cast because unit tests have no real
// stack. Integration tests (collect-plugins.integration.ts) use the real
// stack.db / stack.registry. tenantId is a valid UUID.
const STUB_CTX: RendererContext = {
  db: null as never,
  registry: null as never,
  tenantId: "11111111-1111-4111-8111-111111111111" as TenantId,
};

// Test helper: minimal plugin with a fixed response. Multiple plugins are
// used for multi-kind tests.
function makePlugin(name: string, kinds: RendererPlugin["kinds"]): RendererPlugin {
  return {
    name,
    kinds,
    render: async (req: RenderRequest): Promise<RenderResponse> => {
      // Return the name in the response so tests can identify which plugin ran
      switch (req.kind) {
        case "mail":
          return { kind: "mail", subject: name, html: `from:${name}`, text: `from:${name}` };
        case "document-pdf":
          return {
            kind: "document-pdf",
            pdfBytes: new Uint8Array([1, 2, 3]),
            pageCount: 1,
            sizeBytes: 3,
            fileName: "x.pdf",
          };
        case "image-snapshot":
          return {
            kind: "image-snapshot",
            imageBytes: new Uint8Array([1]),
            format: "png",
            width: 1,
            height: 1,
          };
      }
    },
  };
}

describe("renderer-foundation :: Plugin-Selection", () => {
  test("default plugin for kind mail = 'mail-html'", async () => {
    const plugin = selectRendererPlugin(
      [makePlugin("other", ["mail"]), makePlugin("mail-html", ["mail"])],
      "mail",
    );
    expect(plugin.name).toBe("mail-html");
  });

  test("default plugin for document-pdf = 'puppeteer'", async () => {
    const plugin = selectRendererPlugin(
      [makePlugin("puppeteer", ["document-pdf", "image-snapshot"])],
      "document-pdf",
    );
    expect(plugin.name).toBe("puppeteer");
  });

  test("the default plugin wins even when another plugin for the kind is mounted first", () => {
    expect(
      selectRendererPlugin(
        [makePlugin("custom-pdf", ["document-pdf"]), makePlugin("puppeteer", ["document-pdf"])],
        "document-pdf",
      ).name,
    ).toBe("puppeteer");
  });

  test("Falls back to the first plugin serving the kind when the default name is not mounted", async () => {
    const plugin = selectRendererPlugin([makePlugin("nonstandard-name", ["mail"])], "mail");
    expect(plugin.name).toBe("nonstandard-name");
  });

  test("no plugin for kind → RendererError", () => {
    expect(() => selectRendererPlugin([makePlugin("mail-html", ["mail"])], "document-pdf")).toThrow(
      RendererError,
    );
  });

  test("empty plugin pool → RendererError for every kind", () => {
    expect(() => selectRendererPlugin([], "mail")).toThrow(RendererError);
    expect(() => selectRendererPlugin([], "document-pdf")).toThrow(RendererError);
    expect(() => selectRendererPlugin([], "image-snapshot")).toThrow(RendererError);
  });

  test("RendererError code='no_plugin_for_kind' when no plugin", () => {
    try {
      selectRendererPlugin([], "mail");
      throw new Error("expected RendererError");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("no_plugin_for_kind");
    }
  });

  test("Plugin with multiple kinds is selected for each matching kind", async () => {
    const plugins = [makePlugin("multi", ["mail", "document-pdf"])];
    expect(selectRendererPlugin(plugins, "mail").name).toBe("multi");
    expect(selectRendererPlugin(plugins, "document-pdf").name).toBe("multi");
  });

  test("Plugin with empty kinds is never selected", () => {
    const plugin = selectRendererPlugin(
      [makePlugin("empty-kinds", []), makePlugin("mail-html", ["mail"])],
      "mail",
    );
    expect(plugin.name).toBe("mail-html");
  });
});

describe("renderer-foundation :: Plugin executes render", () => {
  test("Plugin.render returns RenderResponse with the same kind", async () => {
    const plugin = selectRendererPlugin([makePlugin("mail-html", ["mail"])], "mail");
    const response = await plugin.render(
      { kind: "mail", payload: { slug: "welcome", locale: "en", variables: {} } },
      STUB_CTX,
    );
    expect(response.kind).toBe("mail");
    if (response.kind === "mail") {
      expect(response.html).toBe("from:mail-html");
    }
  });
});
