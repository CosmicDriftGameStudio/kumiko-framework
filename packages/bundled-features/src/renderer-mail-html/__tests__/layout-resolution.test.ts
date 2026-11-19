import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  type RendererContext,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import * as templateResolverModule from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { mailHtmlRender } from "../render";

const LOCALE = "de";
const SLUG = "mail-demo:notify:welcome";

const MAIL_TEMPLATE: TemplateResource = {
  id: "template-1",
  version: 1,
  tenantId: "tenant-1",
  slug: SLUG,
  kind: "mail",
  locale: LOCALE,
  title: null,
  folder: null,
  content: "<p>Hallo</p>",
  contentFormat: "html",
  variableSchema: {},
  linkedResources: {},
  meta: { subject: "Betreff" },
  scope: "tenant",
  parentTemplateId: null,
  status: "active",
  modifiedAt: null,
};

function unexpectedCall(): never {
  throw new Error("unexpected call");
}

function stubResolverApi(resolveLayoutError: Error): TemplateResolverApi {
  return {
    findExact: unexpectedCall,
    resolveTemplate: async () => MAIL_TEMPLATE,
    resolveLayout: async () => {
      throw resolveLayoutError;
    },
  };
}

// The render never reads the db itself: the template resolver is stubbed and no config accessor is set.
const fakeContext: RendererContext = {
  db: {} as unknown as DbRunner,
  registry: createRegistry([]),
  tenantId: "tenant-1" as TenantId,
};

function renderMail() {
  return mailHtmlRender(
    { kind: "mail", payload: { slug: SLUG, locale: LOCALE, variables: {} } },
    fakeContext,
  );
}

describe("renderer-mail-html :: layout resolution errors", () => {
  let resolverApiSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    resolverApiSpy?.mockRestore();
    resolverApiSpy = undefined;
  });

  function failLayoutResolutionWith(error: Error) {
    resolverApiSpy = spyOn(templateResolverModule, "createTemplateResolverApi").mockReturnValue(
      stubResolverApi(error),
    );
  }

  test("a layout resolution failure other than not-found is a RendererError with code other", async () => {
    failLayoutResolutionWith(new Error("connection reset"));
    const failure = await renderMail().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RendererError);
    if (failure instanceof RendererError) {
      expect(failure.code).toBe("other");
      expect(failure.message).toContain("layout resolution failed");
      expect(failure.message).toContain("connection reset");
    }
  });

  test("a layout that is not found still falls back to the in-code layout", async () => {
    failLayoutResolutionWith(
      new TemplateNotFoundError({ slug: "default", kind: "mail-layout", locale: LOCALE }),
    );
    const result = await renderMail();
    if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
    expect(result.html).toContain("<table");
    expect(result.layout).toBeUndefined();
  });
});
