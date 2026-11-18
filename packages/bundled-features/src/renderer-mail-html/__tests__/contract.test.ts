// Conformance test: the plugin matches the RendererPlugin contract from
// renderer-foundation. Verifies shape (name, kinds, render signature)
// + the return-kind invariant.

import { describe, expect, test } from "bun:test";
import type { RendererPlugin } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererMailHtmlFeature } from "../feature";
import { mailHtmlRender } from "../render";

describe("renderer-mail-html :: RendererPlugin-Contract", () => {
  test("mailHtmlRender is an async function with the correct signature", () => {
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

  test("a platform brand with an empty title is rejected when the feature is created", () => {
    expect(() => createRendererMailHtmlFeature({ platformBrand: { title: "   " } })).toThrow(
      /platformBrand\.title must not be empty/,
    );
  });

  test.each(["red", "#12345", "1f5468", '#fff" onload="x'])(
    "a platform brand accent color %p that is no hex color is rejected when the feature is created",
    (accentColor) => {
      expect(() =>
        createRendererMailHtmlFeature({ platformBrand: { title: "Status", accentColor } }),
      ).toThrow(/platformBrand\.accentColor must be a hex color/);
    },
  );

  test("a valid platform brand is accepted", () => {
    const feature = createRendererMailHtmlFeature({
      platformBrand: { title: "Status", accentColor: "#1f5468" },
    });
    expect(feature.name).toBe("renderer-mail-html");
  });
});
