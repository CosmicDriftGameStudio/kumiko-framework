import { describe, expect, test } from "bun:test";
import { PREVIEW_TARGETS } from "@cosmicdrift/kumiko-renderer";
import { TEMPLATE_KINDS } from "../constants.ts";
import { previewTargetOfKind } from "../preview-targets.ts";

describe("previewTargetOfKind", () => {
  test("every kind with an editor has a registered preview target", () => {
    const editable = TEMPLATE_KINDS.filter(
      (kind) => kind !== "notification" && kind !== "image-snapshot",
    );
    expect(Object.keys(previewTargetOfKind).sort()).toEqual([...editable].sort());
    for (const target of Object.values(previewTargetOfKind)) {
      expect(PREVIEW_TARGETS).toContain(target);
    }
  });

  test("layouts follow the format they frame, snippets and prompts preview as text", () => {
    expect(previewTargetOfKind["mail-layout"]).toBe("mail");
    expect(previewTargetOfKind["pdf-layout"]).toBe("pdf");
    expect(previewTargetOfKind.snippet).toBe("text");
    expect(previewTargetOfKind["ai-prompt"]).toBe("text");
    expect(previewTargetOfKind["text-block"]).toBe("web");
  });
});
