import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  type ResolveLayoutRequest,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "../api.ts";
import { resolveTrustedLayout } from "../stored-template-body.ts";
import { SYSTEM_TENANT_ID } from "../web/constants.ts";

const SLUG = "pdf-demo:layout:letter";
const LOCALE = "de";
const TENANT = "tenant-1" as TenantId;

const VALID_HTML = "<div data-header><p>Head</p></div><div data-content></div>";
const FORM_HTML =
  '<div data-header><form action="https://evil.example"><input name="x"></form></div><div data-content></div>';
const JAVASCRIPT_LINK_HTML =
  '<div data-header><a href="javascript:alert(1)">x</a></div><div data-content></div>';

function layoutFixture(overrides: Partial<TemplateResource>): TemplateResource {
  return {
    id: "layout-1",
    version: 1,
    tenantId: TENANT,
    slug: SLUG,
    kind: "pdf-layout",
    locale: LOCALE,
    title: null,
    folder: null,
    content: VALID_HTML,
    contentFormat: "html",
    variableSchema: {},
    linkedResources: {},
    meta: {},
    scope: "tenant",
    parentTemplateId: null,
    status: "active",
    modifiedAt: null,
    ...overrides,
  };
}

const SYSTEM_LAYOUT = layoutFixture({
  id: "layout-system",
  tenantId: SYSTEM_TENANT_ID,
  scope: "system",
  content: "<div data-header><p>System</p></div><div data-content></div>",
});

function unexpectedCall(): never {
  throw new Error("unexpected call");
}

function stubResolverApi(tenantRow: TemplateResource | Error) {
  const calls: ResolveLayoutRequest[] = [];
  const api: TemplateResolverApi = {
    findExact: unexpectedCall,
    resolveTemplate: unexpectedCall,
    resolveLayout: async (request) => {
      calls.push(request);
      if (request.tenantId === SYSTEM_TENANT_ID) {
        if (tenantRow instanceof Error) throw tenantRow;
        return SYSTEM_LAYOUT;
      }
      if (tenantRow instanceof Error) throw tenantRow;
      return tenantRow;
    },
  };
  return { api, calls };
}

const REQUEST: ResolveLayoutRequest = {
  tenantId: TENANT,
  slug: SLUG,
  kind: "pdf-layout",
  locale: LOCALE,
};

describe("resolveTrustedLayout", () => {
  test("a tenant html layout is returned sanitized", async () => {
    const { api, calls } = stubResolverApi(layoutFixture({ content: FORM_HTML }));
    const layout = await resolveTrustedLayout(api, REQUEST);
    expect(layout.scope).toBe("tenant");
    expect(layout.content).not.toContain("<form");
    expect(layout.content).not.toContain("evil.example");
    expect(calls).toHaveLength(1);
  });

  test("a tenant layout failing the sanitizer is replaced by the system layout without working", async () => {
    const { api, calls } = stubResolverApi(layoutFixture({ content: JAVASCRIPT_LINK_HTML }));
    const layout = await resolveTrustedLayout(api, { ...REQUEST, working: true });
    expect(layout).toBe(SYSTEM_LAYOUT);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(calls[1]?.working).toBeUndefined();
  });

  test("a tenant layout that is not html is replaced by the system layout", async () => {
    const { api } = stubResolverApi(layoutFixture({ contentFormat: "mjml" }));
    expect(await resolveTrustedLayout(api, REQUEST)).toBe(SYSTEM_LAYOUT);
  });

  test("a system layout comes back unchanged after one lookup", async () => {
    const { api, calls } = stubResolverApi(SYSTEM_LAYOUT);
    expect(await resolveTrustedLayout(api, REQUEST)).toBe(SYSTEM_LAYOUT);
    expect(calls).toHaveLength(1);
  });

  test("an already resolved tenant layout is not looked up again", async () => {
    const { api, calls } = stubResolverApi(new Error("must not be read"));
    const layout = await resolveTrustedLayout(api, REQUEST, layoutFixture({}));
    expect(layout.content).toContain("Head");
    expect(calls).toHaveLength(0);
  });

  test("a missing system layout behind a rejected tenant layout rejects with TemplateNotFoundError", async () => {
    const notFound = new TemplateNotFoundError({ slug: SLUG, kind: "pdf-layout", locale: LOCALE });
    const { api } = stubResolverApi(notFound);
    const rejected = await resolveTrustedLayout(
      api,
      REQUEST,
      layoutFixture({ content: JAVASCRIPT_LINK_HTML }),
    ).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(TemplateNotFoundError);
  });
});
