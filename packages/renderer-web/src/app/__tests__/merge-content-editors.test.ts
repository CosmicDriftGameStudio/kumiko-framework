import { describe, expect, spyOn, test } from "bun:test";
import type { ContentEditorComponent } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "../client-plugin";
import { mergeContentEditors } from "../create-app";

const editor = (): ContentEditorComponent => (() => null) as ContentEditorComponent;

describe("mergeContentEditors", () => {
  test("merges contentEditors from multiple clientFeatures", () => {
    const plainEditor = editor();
    const richEditor = editor();
    const features: ClientFeatureDefinition[] = [
      { name: "a", contentEditors: { plain: plainEditor } },
      { name: "b", contentEditors: { rich: richEditor } },
    ];

    const merged = mergeContentEditors(features);
    expect(merged["plain"]).toBe(plainEditor);
    expect(merged["rich"]).toBe(richEditor);
  });

  test("Key-Kollision → warnt + last-wins gewinnt", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const first = editor();
    const second = editor();
    const features: ClientFeatureDefinition[] = [
      { name: "first", contentEditors: { plain: first } },
      { name: "second", contentEditors: { plain: second } },
    ];

    const merged = mergeContentEditors(features);
    expect(merged["plain"]).toBe(second);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('contentEditor "plain" defined by multiple clientFeatures'),
    );

    warnSpy.mockRestore();
  });

  test("clientFeatures ohne contentEditors werden übersprungen", () => {
    const features: ClientFeatureDefinition[] = [{ name: "a" }];
    expect(mergeContentEditors(features)).toEqual({});
  });
});
