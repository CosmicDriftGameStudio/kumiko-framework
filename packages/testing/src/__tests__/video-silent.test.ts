import { describe, expect, test } from "bun:test";
import { defineVideo } from "../e2e/video/define-video";
import { buildMuxArgs, buildPosterArgs } from "../e2e/video/mux";
import { createNarrator } from "../e2e/video/narration";
import { sceneExtensionMs } from "../e2e/video/scene-plan";
import { findVideoTextGaps } from "../e2e/video/video-texts";

const scene = { id: "a", do: async () => {} };

describe("silent defineVideo", () => {
  test("accepts a definition without voice", () => {
    expect(() => defineVideo({ scenes: [scene] })).not.toThrow();
  });

  test("rejects music without voice", () => {
    expect(() => defineVideo({ music: { file: "/m.mp3" }, scenes: [scene] })).toThrow(
      /music needs a voice/,
    );
  });

  test("needs no text file", () => {
    expect(findVideoTextGaps({ scenes: [scene] }, "/does/not/exist", ["en"])).toEqual([]);
  });
});

describe("silent buildMuxArgs", () => {
  const frames = [{ path: "f.png", durationMs: 1000 }];
  const silent = { frames, sceneAudio: [], silent: true, outMp4: "out.mp4", workDir: "w" };

  test("has no audio input, mapping or filter and drops audio", () => {
    const args = buildMuxArgs(silent, "list.txt");
    expect(args.filter((arg) => arg === "-i")).toHaveLength(1);
    expect(args).toContain("-an");
    expect(args).not.toContain("-shortest");
    expect(args).not.toContain("-c:a");
    expect(args.join(" ")).not.toContain("aout");
    expect(args.join(" ")).not.toContain("atempo");
    expect(args.filter((arg) => arg === "-map")).toHaveLength(1);
    expect(args.at(-1)).toBe("out.mp4");
  });

  test("keeps the brand overlay and playbackRate on the picture", () => {
    const args = buildMuxArgs({ ...silent, brandPng: "b.png", playbackRate: 2 }, "list.txt");
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toBe("[0:v]setpts=PTS/2,fps=30[base];[base][1:v]overlay=W-w-40:H-h-40[vout]");
  });

  test("refuses audio on a silent video and silence on a voiced one", () => {
    const audio = [{ wavPath: "a.wav", startMs: 0, durationMs: 500, sceneMs: 1000 }];
    expect(() => buildMuxArgs({ ...silent, sceneAudio: audio }, "list.txt")).toThrow(/silent/);
    expect(() => buildMuxArgs({ ...silent, silent: false }, "list.txt")).toThrow(/voiced/);
  });

  test("refuses music", () => {
    expect(() => buildMuxArgs({ ...silent, music: { file: "m.mp3" } }, "list.txt")).toThrow(
      /silent/,
    );
  });

  test("voiced videos keep their audio track", () => {
    const args = buildMuxArgs(
      {
        frames,
        sceneAudio: [{ wavPath: "a.wav", startMs: 0, durationMs: 500, sceneMs: 1000 }],
        outMp4: "out.mp4",
        workDir: "w",
      },
      "list.txt",
    );
    expect(args).toContain("-shortest");
    expect(args).toContain("aac");
    expect(args).not.toContain("-an");
    expect(args[args.lastIndexOf("-map") + 1]).toBe("[aout]");
  });
});

describe("scene plan", () => {
  test("a silent scene is not extended", () => {
    expect(sceneExtensionMs(100, undefined)).toBe(0);
  });

  test("a voiced scene still holds speech plus tail", () => {
    expect(sceneExtensionMs(100, 1000)).toBe(1300);
  });
});

describe("poster", () => {
  test("the poster is the first frame of the mp4", () => {
    expect(buildPosterArgs("/o/en.mp4", "/o/en.jpg")).toEqual([
      "-y",
      "-i",
      "/o/en.mp4",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "/o/en.jpg",
    ]);
  });
});

describe("createNarrator", () => {
  const base = {
    videoId: "v",
    videoDir: "/v",
    locale: "en",
    ttsCacheDir: "/c",
    apiKey: undefined,
  };

  test("silent video loads no texts and calls no TTS", () => {
    const calls: string[] = [];
    const narrator = createNarrator({
      ...base,
      video: {},
      loadTexts: () => {
        calls.push("texts");
        return {};
      },
      synthesize: async () => {
        calls.push("tts");
        return { wavPath: "x.wav", durationMs: 1 };
      },
    });
    expect(narrator).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("voiced video narrates each scene with its text and voice", async () => {
    const voices: string[] = [];
    const narrator = createNarrator({
      ...base,
      video: { voice: { voice: "Kore" } },
      loadTexts: () => ({ a: "Hello" }),
      synthesize: async (options) => {
        voices.push(`${options.voice.voice}:${options.text}`);
        return { wavPath: "x.wav", durationMs: 700 };
      },
    });
    expect(await narrator?.narrate(scene)).toEqual({
      text: "Hello",
      speech: { wavPath: "x.wav", durationMs: 700 },
    });
    expect(voices).toEqual(["Kore:Hello"]);
  });

  test("voiced video without a scene text fails", async () => {
    const narrator = createNarrator({
      ...base,
      video: { voice: { voice: "Kore" } },
      loadTexts: () => ({}),
    });
    await expect(narrator?.narrate(scene)).rejects.toThrow('scene "a" has no text');
  });
});
