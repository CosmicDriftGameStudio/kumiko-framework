import { describe, expect, spyOn, test } from "bun:test";
import type { PreviewRenderer } from "../../../index.ts";
import type { ClientFeatureDefinition } from "../client-plugin.tsx";
import { mergeContentPreviews } from "../create-app.tsx";

const renderer = (): PreviewRenderer => (() => null) as PreviewRenderer;

describe("mergeContentPreviews", () => {
  test("merges the previews of several clientFeatures by target", () => {
    const mail = renderer();
    const web = renderer();
    const features: ClientFeatureDefinition[] = [
      { name: "a", contentPreviews: { mail } },
      { name: "b", contentPreviews: { web } },
    ];
    const merged = mergeContentPreviews(features);
    expect(merged["mail"]).toBe(mail);
    expect(merged["web"]).toBe(web);
  });

  test("two features for one target warn and the later one wins", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const first = renderer();
    const second = renderer();
    const merged = mergeContentPreviews([
      { name: "first", contentPreviews: { web: first } },
      { name: "second", contentPreviews: { web: second } },
    ]);
    expect(merged["web"]).toBe(second);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('contentPreview "web" defined by multiple clientFeatures'),
    );
    warn.mockRestore();
  });

  test("features without previews add nothing", () => {
    expect(mergeContentPreviews([{ name: "a" }])).toEqual({});
  });
});
