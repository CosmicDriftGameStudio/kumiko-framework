import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEAD_IN_MS, leadInMs, writeKindSpecificFile } from "../e2e/video/kind-specific-output";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function outputDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "video-kind-output-"));
  dirs.push(dir);
  return dir;
}

const cues = [{ startMs: 500, endMs: 2500, text: "Hello" }];

describe("writeKindSpecificFile", () => {
  test("a silent run after a voiced run removes the old subtitles and writes the poster", () => {
    const dir = outputDir();
    const vttPath = join(dir, "en.vtt");
    writeFileSync(vttPath, "WEBVTT\n");
    const posters: string[][] = [];

    writeKindSpecificFile(
      {
        silent: true,
        outMp4: join(dir, "en.mp4"),
        vttPath,
        posterPath: join(dir, "en.jpg"),
        cues: [],
        playbackRate: undefined,
      },
      (mp4, poster) => posters.push([mp4, poster]),
    );

    expect(existsSync(vttPath)).toBe(false);
    expect(posters).toEqual([[join(dir, "en.mp4"), join(dir, "en.jpg")]]);
  });

  test("a voiced run writes the subtitles and keeps a hand-placed poster", () => {
    const dir = outputDir();
    const vttPath = join(dir, "en.vtt");
    const posterPath = join(dir, "en.jpg");
    writeFileSync(posterPath, "hand-placed");
    const posters: string[][] = [];

    writeKindSpecificFile(
      {
        silent: false,
        outMp4: join(dir, "en.mp4"),
        vttPath,
        posterPath,
        cues,
        playbackRate: undefined,
      },
      (mp4, poster) => posters.push([mp4, poster]),
    );

    expect(readFileSync(vttPath, "utf-8")).toContain("Hello");
    expect(readFileSync(posterPath, "utf-8")).toBe("hand-placed");
    expect(posters).toEqual([]);
  });
});

describe("leadInMs", () => {
  test("only a voiced video holds the first frame for the lead-in", () => {
    expect(leadInMs(false)).toBe(LEAD_IN_MS);
    expect(leadInMs(true)).toBe(0);
  });
});
