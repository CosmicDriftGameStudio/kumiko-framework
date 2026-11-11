import { describe, expect, test } from "bun:test";
import { editorStage, terminalStage } from "../e2e";
import { seededRandom, typedWidthKeyframes, typingOffsetsMs } from "../e2e/video/typing";

const rhythm = { charMs: 70, jitterMs: 35, spaceExtraMs: 90 };

describe("typingOffsetsMs", () => {
  test("same seed gives the same offsets, another seed differs", () => {
    const a = typingOffsetsMs("hello world", rhythm, seededRandom(7));
    expect(typingOffsetsMs("hello world", rhythm, seededRandom(7))).toEqual(a);
    expect(typingOffsetsMs("hello world", rhythm, seededRandom(8))).not.toEqual(a);
  });

  test("offsets are positive and strictly increasing", () => {
    const offsets = typingOffsetsMs("a b c d e f g", rhythm, seededRandom(3));
    expect(offsets[0]).toBeGreaterThan(0);
    offsets.forEach((offset, index) => {
      if (index > 0) expect(offset).toBeGreaterThan(offsets[index - 1] ?? 0);
    });
  });

  test("a space delays the following character", () => {
    const flat = { charMs: 50, jitterMs: 0, spaceExtraMs: 90 };
    const [a, space, b] = typingOffsetsMs("a b", flat, seededRandom(1));
    expect((b ?? 0) - (space ?? 0)).toBe(140);
    expect((space ?? 0) - (a ?? 0)).toBe(50);
  });

  test("width keyframes step up to the full length", () => {
    const { css, durationMs } = typedWidthKeyframes("t", [100, 200, 300]);
    expect(durationMs).toBe(300);
    expect(css).toContain("0% { width: 0ch;");
    expect(css).toContain("100% { width: 3ch;");
  });
});

describe("terminalStage", () => {
  test("escapes output text", () => {
    const { html } = terminalStage({ commands: [{ command: "echo", output: ["<b>bold</b>"] }] });
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold");
  });

  test("promptAfter changes the path pill only for the lines after its command", () => {
    const { html } = terminalStage({
      prompt: "~",
      commands: [{ command: "cd app", promptAfter: "~/app" }, { command: "ls" }],
    });
    const pills = [...html.matchAll(/<span class="pill">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(pills).toEqual(["~", "~/app", "~/app"]);
  });

  test("tab and pane header switch to the new path when the command finishes", () => {
    const { html } = terminalStage({
      prompt: "~",
      commands: [{ command: "cd app", promptAfter: "~/app" }],
    });
    const switchers = [
      ...html.matchAll(/<span class="paths">((?:<span[^>]*>[^<]*<\/span>)+)<\/span>/g),
    ];
    expect(switchers).toHaveLength(2);
    for (const switcher of switchers) {
      const paths = [...(switcher[1] ?? "").matchAll(/>([^<]+)</g)].map((m) => m[1]);
      expect(paths).toEqual(["~", "~/app"]);
      expect(switcher[1]).toMatch(/^<span style="animation: on 1ms steps\(1\) 0ms both, off 1ms/);
    }
  });

  test("meta shows the time from Enter to the last output line", () => {
    const quick = terminalStage({ commands: [{ command: "true", busyMs: 600 }] }).html;
    expect(quick).toContain("600ms • exit 0");
    const slow = terminalStage({ commands: [{ command: "true", busyMs: 1500 }] }).html;
    expect(slow).toContain("1.50s • exit 0");
    const measured = terminalStage({
      commands: [{ command: "true", busyMs: 600, elapsedMs: 4930 }],
    }).html;
    expect(measured).toContain("4.93s • exit 0");
    expect(measured).not.toContain("600ms • exit 0");
  });

  test("keepsRunning shows no meta and no following prompt", () => {
    const { html } = terminalStage({
      commands: [{ command: "bun dev", output: ["ready"], keepsRunning: true }],
    });
    expect(html).not.toContain("exit 0</span>");
    expect(html.match(/<span class="pill">/g)).toHaveLength(1);
  });

  test("keepsRunning is rejected on a command that is not the last", () => {
    expect(() =>
      terminalStage({ commands: [{ command: "bun dev", keepsRunning: true }, { command: "ls" }] }),
    ).toThrow("keepsRunning");
  });

  test("duration grows with more commands and longer holds", () => {
    const one = terminalStage({ commands: [{ command: "ls" }] }).durationMs;
    const two = terminalStage({ commands: [{ command: "ls" }, { command: "pwd" }] }).durationMs;
    const held = terminalStage({ commands: [{ command: "ls", holdMs: 3000 }] }).durationMs;
    expect(two).toBeGreaterThan(one);
    expect(held).toBeGreaterThan(one);
  });
});

describe("terminalStage preview", () => {
  const base = {
    commands: [{ command: "ls", output: ["a", "b"], busyMs: 100, holdMs: 400 }],
  };
  const preview = {
    imageUrl: "file:///shot.png",
    imageWidthPx: 1280,
    imageHeightPx: 1000,
    highlights: [{ x: 136, y: 508, width: 624, height: 84 }],
    cards: [
      { title: "A", lines: ["x"] },
      { title: "B", lines: [] },
    ],
  };

  test("a wrapping command is revealed per character, untyped characters take no width", () => {
    const command = "for guest in a b; do curl x; done";
    const { html } = terminalStage({ ...base, commands: [{ command }], preview });
    const chars = [
      ...html.matchAll(
        /<span class="ch" style="animation: char-in 1ms steps\(1, end\) (\d+)ms forwards">(.*?)<\/span>/g,
      ),
    ];
    expect(chars).toHaveLength(command.length);
    const delays = chars.map((match) => Number(match[1]));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(html).toContain(".ch { display: inline-block; width: 0;");
    expect(html).toContain("@keyframes char-in { from { width: 0; } to { width: 1ch; } }");
    expect(html).not.toContain('class="typed"');
  });

  test("the single-line stage keeps the width-clipped typing", () => {
    const { html } = terminalStage(base);
    expect(html).toContain('class="typed"');
    expect(html).not.toContain('class="ch"');
  });

  test("meta never wraps mid-text", () => {
    const { html } = terminalStage(base);
    expect(html).toMatch(/\.meta \{[^}]*white-space: nowrap/);
  });

  test("without preview there is no preview pane or focus switch", () => {
    const stage = terminalStage(base);
    expect(stage.html).not.toContain("preview");
    expect(stage.focusSwitchMs).toBeUndefined();
  });

  test("renders image and highlight, switches 300ms after the last output, duration covers the last card", () => {
    const plain = terminalStage(base);
    const stage = terminalStage({ ...base, preview });
    expect(stage.html).toContain('src="file:///shot.png"');
    expect(stage.html).toContain("left:10%;top:50%;width:50%;height:10%");
    // plain duration = lastOutput + holdMs (400) + final blink (1200)
    const lastOutputMs = plain.durationMs - 1200 - 400;
    expect(stage.focusSwitchMs).toBeCloseTo(lastOutputMs + 300, 6);
    const lastCardStartMs = lastOutputMs + 300 + 900 + 450;
    expect(stage.durationMs).toBeCloseTo(lastCardStartMs + 350 + 2500, 6);
  });
});

describe("editorStage", () => {
  test("indent of a typed line is outside the width clip", () => {
    const { html } = editorStage({ fileName: "a.ts", lines: [{ typed: "    return 1;" }] });
    expect(html).toMatch(/<span class="indent"> {4}<\/span><span class="typed"/);
  });

  test("line numbers start at firstLineNumber", () => {
    const { html } = editorStage({
      fileName: "a.ts",
      firstLineNumber: 12,
      lines: ["const a = 1;", "const b = 2;"],
    });
    expect(html).toContain('<span class="gutter">12</span>');
    expect(html).toContain('<span class="gutter">13</span>');
    expect(html).not.toContain('<span class="gutter">1</span>');
  });

  describe("preview", () => {
    const base = {
      fileName: "a.ts",
      startDelayMs: 100,
      lines: [{ typed: "const a = 1;" }],
    };
    const preview = {
      imageUrl: "file:///shot.png",
      imageWidthPx: 1280,
      imageHeightPx: 1000,
      highlights: [{ x: 136, y: 508, width: 624, height: 84 }],
      cards: [
        { title: "A <b>", lines: ["x & y"] },
        { title: "B", lines: [] },
      ],
    };

    test("without preview there is no preview pane or focus switch", () => {
      const stage = editorStage(base);
      expect(stage.html).not.toContain("preview");
      expect(stage.focusSwitchMs).toBeUndefined();
    });

    test("image, highlight percentages and escaped cards are rendered", () => {
      const { html } = editorStage({ ...base, preview });
      expect(html).toContain('src="file:///shot.png"');
      expect(html).toContain("left:10%;top:50%;width:50%;height:10%");
      expect(html).toContain("A &lt;b&gt;");
      expect(html).toContain("x &amp; y");
    });

    test("a highlight past the screenshot edge is cut at the edge", () => {
      const { html } = editorStage({
        ...base,
        preview: { ...preview, highlights: [{ x: 1000, y: 800, width: 400, height: 400 }] },
      });
      expect(html).toContain("left:77.5%;top:79.2%;width:22.5%;height:20.8%");
    });

    test("a before image is shown first and the result fades in at the focus switch", () => {
      const plain = editorStage(base);
      const typingEndMs = plain.durationMs - 1500;
      const { html } = editorStage({
        ...base,
        preview: { ...preview, beforeImageUrl: "file:///before.png" },
      });
      expect(html).toContain(
        '<img src="file:///before.png" alt=""><img class="after" src="file:///shot.png"',
      );
      expect(html).toContain(
        ".shot img.after { position: absolute; inset: 0; opacity: 0; animation: crossfade-in 500ms ease-in-out",
      );
      expect(html).toContain(
        `crossfade-in 500ms ease-in-out ${Math.round(typingEndMs + 300)}ms both`,
      );
      expect(editorStage({ ...base, preview }).html).not.toContain('class="after"');
    });

    test("several highlights render one box each", () => {
      const { html } = editorStage({
        ...base,
        preview: {
          ...preview,
          highlights: [
            { x: 136, y: 508, width: 624, height: 84 },
            { x: 136, y: 100, width: 100, height: 100 },
          ],
        },
      });
      expect(html.match(/class="highlight"/g)).toHaveLength(2);
    });

    test("focus switches 300ms after typing and duration covers the last card", () => {
      const plain = editorStage(base);
      const stage = editorStage({ ...base, preview });
      const typingEndMs = plain.durationMs - 1500;
      expect(stage.focusSwitchMs).toBe(typingEndMs + 300);
      const lastCardStartMs = typingEndMs + 300 + 900 + 450;
      expect(stage.durationMs).toBe(lastCardStartMs + 350 + 2500);
    });
  });
});
