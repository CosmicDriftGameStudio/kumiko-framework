import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createRendererFoundationApi } from "../api.js";
import {
  type RendererContext,
  RendererError,
  type RendererPlugin,
  type RenderRequest,
  type RenderResponse,
} from "../types.js";

// Stub-Context für Plugin-Render-Calls in Unit-Tests. makePlugin ignoriert
// ctx; db+registry sind hier null-cast weil Unit-Tests keinen echten
// Stack haben — Integration-Tests (collect-plugins.integration.ts) nutzen
// echte stack.db / stack.registry. tenantId ist valid UUID (Memory-Lesson
// feedback_system_tenant_id_is_uuid).
const STUB_CTX: RendererContext = {
  db: null as never,
  registry: null as never,
  tenantId: "11111111-1111-4111-8111-111111111111" as TenantId,
};

// Test-Helper: minimal Plugin mit fix-Response. Mehrere im Pool für
// Multi-Kind- + Tenant-Override-Tests.
function makePlugin(name: string, kinds: RendererPlugin["kinds"]): RendererPlugin {
  return {
    name,
    kinds,
    render: async (req: RenderRequest): Promise<RenderResponse> => {
      // shape-by-kind, gibt name in der response damit Tests sehen welcher plugin lief
      switch (req.kind) {
        case "mail":
          return { kind: "mail", subject: name, html: `from:${name}`, text: `from:${name}` };
        case "document-pdf":
          return {
            kind: "document-pdf",
            pdfBytes: new Uint8Array([1, 2, 3]),
            pageCount: 1,
            sizeBytes: 3,
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

const TENANT: TenantId = "22222222-2222-4222-8222-222222222222" as TenantId;

describe("renderer-foundation :: Plugin-Selection", () => {
  test("default-plugin für kind mail = 'mail-html'", async () => {
    const api = createRendererFoundationApi([
      makePlugin("other", ["mail"]),
      makePlugin("mail-html", ["mail"]),
    ]);
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("mail-html");
  });

  test("default-plugin für document-pdf = 'puppeteer'", async () => {
    const api = createRendererFoundationApi([
      makePlugin("puppeteer", ["document-pdf", "image-snapshot"]),
    ]);
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" });
    expect(plugin.name).toBe("puppeteer");
  });

  test("Tenant-Override gewinnt vor Default", async () => {
    const api = createRendererFoundationApi(
      [makePlugin("mail-html", ["mail"]), makePlugin("custom-mail", ["mail"])],
      (tid) => (tid === TENANT ? { mail: "custom-mail" } : null),
    );
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("custom-mail");
  });

  test("Tenant-Override auf nicht-registriertes Plugin → fällt durch auf Default", async () => {
    const api = createRendererFoundationApi([makePlugin("mail-html", ["mail"])], () => ({
      mail: "ghost-plugin",
    }));
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("mail-html");
  });

  test("Fallback auf erstes passendes Plugin wenn weder Tenant-Config noch Default-Name matchen", async () => {
    const api = createRendererFoundationApi([makePlugin("nonstandard-name", ["mail"])]);
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("nonstandard-name");
  });

  test("kein Plugin für kind → RendererError", () => {
    const api = createRendererFoundationApi([makePlugin("mail-html", ["mail"])]);
    expect(() => api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" })).toThrow(
      RendererError,
    );
  });

  test("leerer Plugin-Pool → RendererError für jeden kind", () => {
    const api = createRendererFoundationApi([]);
    expect(() => api.createRendererForTenant({ tenantId: TENANT, kind: "mail" })).toThrow(
      RendererError,
    );
    expect(() => api.createRendererForTenant({ tenantId: TENANT, kind: "mail" })).toThrow(
      RendererError,
    );
    expect(() => api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" })).toThrow(
      RendererError,
    );
    expect(() => api.createRendererForTenant({ tenantId: TENANT, kind: "image-snapshot" })).toThrow(
      RendererError,
    );
  });

  test("RendererError code='no_plugin_for_kind' wenn kein Plugin", () => {
    const api = createRendererFoundationApi([]);
    try {
      api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
      throw new Error("expected RendererError");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("no_plugin_for_kind");
    }
  });

  test("Plugin mit mehreren kinds wird für jeden passend gewählt", async () => {
    const multi = makePlugin("multi", ["mail", "document-pdf"]);
    const api = createRendererFoundationApi([multi]);
    expect(api.createRendererForTenant({ tenantId: TENANT, kind: "mail" }).name).toBe("multi");
    expect(api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" }).name).toBe(
      "multi",
    );
  });

  test("Plugin mit leeren kinds wird nie ausgewählt", () => {
    const api = createRendererFoundationApi([
      makePlugin("empty-kinds", []),
      makePlugin("mail-html", ["mail"]),
    ]);
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("mail-html");
  });

  test("Tenant-Override mit falschem kind-Plugin → ignoriert, Fallback", async () => {
    // Tenant config picks "puppeteer" for mail, but puppeteer only renders
    // document-pdf. The foundation must ignore an entry with the wrong kind.
    const api = createRendererFoundationApi(
      [makePlugin("mail-html", ["mail"]), makePlugin("puppeteer", ["document-pdf"])],
      () => ({ mail: "puppeteer" }),
    );
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
    expect(plugin.name).toBe("mail-html");
  });
});

describe("renderer-foundation :: Plugin executes render", () => {
  test("Plugin.render returnt RenderResponse mit gleichem kind", async () => {
    const api = createRendererFoundationApi([makePlugin("mail-html", ["mail"])]);
    const plugin = api.createRendererForTenant({ tenantId: TENANT, kind: "mail" });
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
