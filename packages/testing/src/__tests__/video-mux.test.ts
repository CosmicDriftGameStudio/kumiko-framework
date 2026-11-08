import { describe, expect, test } from "bun:test";
import { defineVideo } from "../e2e/video/define-video";
import {
  buildAudioFilter,
  buildFrameConcatList,
  buildMusicMixFilter,
  buildMuxArgs,
  buildVideoFilter,
  buildVtt,
} from "../e2e/video/mux";

describe("buildVtt", () => {
  test("formats cues with HH:MM:SS.mmm timestamps", () => {
    expect(
      buildVtt([
        { startMs: 0, endMs: 1500, text: "One" },
        { startMs: 3_723_004, endMs: 3_725_000, text: "Two" },
      ]),
    ).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nOne\n\n01:02:03.004 --> 01:02:05.000\nTwo\n");
  });

  test("keeps a cue whole when its text holds markup, an arrow or a blank line", () => {
    expect(buildVtt([{ startMs: 0, endMs: 1000, text: "A & <b> --> B\n\nC" }])).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA &amp; &lt;b> --&gt; B\nC\n",
    );
  });
});

describe("buildFrameConcatList", () => {
  test("lists durations in seconds and repeats the last file", () => {
    const list = buildFrameConcatList([
      { path: "/f/a.png", durationMs: 500 },
      { path: "/f/b.png", durationMs: 33.3333 },
    ]);
    expect(list.split("\n")).toEqual([
      "file '/f/a.png'",
      "duration 0.5000",
      "file '/f/b.png'",
      "duration 0.0333",
      "file '/f/b.png'",
      "",
    ]);
  });

  test("escapes single quotes in paths", () => {
    expect(buildFrameConcatList([{ path: "/f/it's.png", durationMs: 100 }])).toContain(
      "file '/f/it'\\''s.png'",
    );
  });
});

describe("buildAudioFilter", () => {
  test("delays the first scene by the intro and pads each scene to its length", () => {
    const filter = buildAudioFilter(
      [
        { wavPath: "a.wav", startMs: 500, durationMs: 1000, sceneMs: 2000 },
        { wavPath: "b.wav", startMs: 2500, durationMs: 500, sceneMs: 1000 },
      ],
      1,
    );
    expect(filter).toContain("[1:a]adelay=500:all=1,apad=whole_dur=2.5000");
    expect(filter).toContain("[2:a]apad=whole_dur=1.0000");
    expect(filter).toContain("[a0][a1]concat=n=2:v=0:a=1[aout]");
  });
});

describe("defineVideo", () => {
  const scene = (id: string) => ({ id, do: async () => {} });

  test("throws on duplicate scene ids", () => {
    expect(() =>
      defineVideo({ voice: { voice: "Kore" }, scenes: [scene("a"), scene("a")] }),
    ).toThrow('duplicate scene id "a"');
  });

  test("throws on an odd viewport dimension", () => {
    expect(() =>
      defineVideo({
        voice: { voice: "Kore" },
        viewport: { width: 1281, height: 720 },
        scenes: [scene("a")],
      }),
    ).toThrow("even");
  });

  test("throws on an empty scene list", () => {
    expect(() => defineVideo({ voice: { voice: "Kore" }, scenes: [] })).toThrow();
  });
});

describe("buildVideoFilter", () => {
  test("without brand only normalizes fps", () => {
    expect(buildVideoFilter(undefined)).toBe("[0:v]fps=30[vout]");
  });

  test("with brand overlays the given input bottom right", () => {
    const filter = buildVideoFilter(4);
    expect(filter).toContain("[base][4:v]overlay=W-w-40:H-h-40[vout]");
    expect(filter).toStartWith("[0:v]fps=30[base];");
  });
});

describe("buildMusicMixFilter", () => {
  test("loops, ducks under the voice and fades out 2 s before the end", () => {
    const filter = buildMusicMixFilter(3, 0.35, 10_000);
    expect(filter).toContain("[3:a]aloop=loop=-1:size=2e9,atrim=0:10.0000,volume=0.35");
    expect(filter).toContain("afade=t=out:st=8.0000:d=2");
    expect(filter).toContain("sidechaincompress=threshold=0.03:ratio=8");
    expect(filter).toContain("amix=inputs=2:duration=first:normalize=0[aout]");
  });

  test("buildAudioFilter can route the voice to another label", () => {
    const scene = { wavPath: "a.wav", startMs: 0, durationMs: 500, sceneMs: 1000 };
    expect(buildAudioFilter([scene], 1, "voice")).toContain("concat=n=1:v=0:a=1[voice]");
    expect(buildAudioFilter([scene], 1)).toContain("[aout]");
  });
});

describe("buildMuxArgs", () => {
  const base = {
    frames: [{ path: "f.png", durationMs: 1000 }],
    sceneAudio: [{ wavPath: "a.wav", startMs: 0, durationMs: 500, sceneMs: 1000 }],
    outMp4: "out.mp4",
    workDir: "w",
  };

  test("writes the metadata comment right before the output", () => {
    const args = buildMuxArgs({ ...base, metadataComment: "AI voice" }, "list.txt");
    expect(args.slice(-3)).toEqual(["-metadata", "comment=AI voice", "out.mp4"]);
  });

  test("omits metadata without a comment", () => {
    expect(buildMuxArgs(base, "list.txt")).not.toContain("-metadata");
  });
});
