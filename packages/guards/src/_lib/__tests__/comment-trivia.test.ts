import { describe, expect, test } from "bun:test";
import { COMMENT_KIND_BLOCK, COMMENT_KIND_LINE, scanCommentTrivia } from "../comment-trivia";

describe("scanCommentTrivia", () => {
  test("returns line and block comments with their start offset", () => {
    const source = "const a = 1; // trailing\n/* block */\nconst b = 2;\n";
    expect(scanCommentTrivia(source)).toEqual([
      { start: source.indexOf("// trailing"), kind: COMMENT_KIND_LINE, text: "// trailing" },
      { start: source.indexOf("/* block */"), kind: COMMENT_KIND_BLOCK, text: "/* block */" },
    ]);
  });

  test("skips comment-like text in strings, templates and regex literals", () => {
    const source = [
      'const s = "// not a comment";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      "const t = `/* nor this */ ${s /* but this */}`;",
      "const r = /\\/\\/ nor this/g;",
      "const ratio = 4 / 2; // real",
    ].join("\n");
    expect(scanCommentTrivia(source).map((comment) => comment.text)).toEqual([
      "/* but this */",
      "// real",
    ]);
  });
});
