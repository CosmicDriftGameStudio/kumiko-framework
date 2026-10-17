import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { extractText, getDocumentProxy } from "unpdf";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
} from "../../renderer-foundation/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createRendererPdfFeature } from "../feature.js";

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererPdfFeature(),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("renderer-pdf :: mounted next to renderer-foundation", () => {
  test("the plugin serves document-pdf and renders through the real registry", async () => {
    const api = createRendererFoundationApi(collectRendererPlugins(stack.registry));
    const renderer = api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" });

    const response = await renderer.render(
      {
        kind: "document-pdf",
        payload: {
          slug: "table",
          locale: "de",
          variables: {
            title: "Stack-Test",
            columns: [{ header: "Name" }],
            rows: [["Müller"]],
          },
        },
      },
      { db: stack.db, registry: stack.registry, tenantId: TENANT },
    );

    expect(renderer.name).toBe("pdf");
    if (response.kind !== "document-pdf") throw new Error("expected document-pdf response");
    const proxy = await getDocumentProxy(new Uint8Array(response.pdfBytes));
    const { text } = await extractText(proxy, { mergePages: true });
    expect(text).toContain("Stack-Test");
    expect(text).toContain("Müller");
  });
});
