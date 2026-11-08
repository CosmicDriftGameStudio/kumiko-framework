import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineVideo } from "../e2e/video/define-video";
import { findVideoTextGaps, loadVideoTexts } from "../e2e/video/video-texts";

const scene = (id: string) => ({ id, do: async () => {} });
const video = defineVideo({
  voice: { voice: "Kore" },
  scenes: [scene("intro"), scene("save")],
});

function videoDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "video-texts-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("loadVideoTexts", () => {
  test("reads scene texts from yaml", () => {
    const dir = videoDirWith({ "text.en.yaml": "intro: Welcome\nsave: Save it\n" });
    expect(loadVideoTexts(dir, "en")).toEqual({ intro: "Welcome", save: "Save it" });
  });

  test("rejects empty texts and names the file", () => {
    const dir = videoDirWith({ "text.en.yaml": 'intro: ""\n' });
    expect(() => loadVideoTexts(dir, "en")).toThrow("text.en.yaml");
  });
});

describe("findVideoTextGaps", () => {
  test("is empty when every scene has a text", () => {
    const dir = videoDirWith({ "text.en.yaml": "intro: a\nsave: b\n" });
    expect(findVideoTextGaps(video, dir, ["en"])).toEqual([]);
  });

  test("reports missing scene texts, surplus texts and missing files", () => {
    const dir = videoDirWith({ "text.en.yaml": "intro: a\nghost: b\n" });
    const gaps = findVideoTextGaps(video, dir, ["en", "de"]);
    expect(gaps).toHaveLength(3);
    expect(gaps.join("\n")).toContain('scene "save" has no text');
    expect(gaps.join("\n")).toContain('text "ghost" has no scene');
    expect(gaps.join("\n")).toContain("de: texts file missing");
  });
});
