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

  test("promptAfter applies only to the lines after its command", () => {
    const { html } = terminalStage({
      prompt: "~ $",
      commands: [{ command: "cd app", promptAfter: "~/app $" }, { command: "ls" }],
    });
    const promptSpans = [...html.matchAll(/<span style="color:#5fd7e6">([^<]*)<\/span>/g)].map(
      (match) => match[1],
    );
    expect(promptSpans).toEqual(["~ $", "~/app $", "~/app $"]);
  });

  test("duration grows with more commands and longer holds", () => {
    const one = terminalStage({ commands: [{ command: "ls" }] }).durationMs;
    const two = terminalStage({ commands: [{ command: "ls" }, { command: "pwd" }] }).durationMs;
    const held = terminalStage({ commands: [{ command: "ls", holdMs: 3000 }] }).durationMs;
    expect(two).toBeGreaterThan(one);
    expect(held).toBeGreaterThan(one);
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
});
