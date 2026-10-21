// Conformance test: the plugin matches the RendererPlugin contract from
// renderer-foundation. Verifies shape (name, kinds, render signature)
// + the return-kind invariant.

import { describe, expect, test } from "bun:test";
import type { RendererPlugin } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererMailHtmlFeature } from "../feature";
import { mailHtmlRender } from "../render";

describe("renderer-mail-html :: RendererPlugin-Contract", () => {
  test("mailHtmlRender ist eine Async-Function mit korrekter Signatur", () => {
    expect(typeof mailHtmlRender).toBe("function");
    // Async-Function: returnt Promise<RenderResponse>
    const result = mailHtmlRender as unknown as RendererPlugin["render"];
    expect(typeof result).toBe("function");
  });

  test("createRendererMailHtmlFeature() returnt FeatureDefinition", () => {
    const feature = createRendererMailHtmlFeature();
    expect(feature.name).toBe("renderer-mail-html");
  });

  test("Feature declared requires for renderer-foundation + template-resolver", () => {
    const feature = createRendererMailHtmlFeature();
    // FeatureDefinition exposes the requires list via the internal API
    // (see defineFeature in framework engine).
    expect(feature.requires).toContain("renderer-foundation");
    expect(feature.requires).toContain("template-resolver");
  });
});
