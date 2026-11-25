import { scanCommentTrivia } from "./comment-trivia";

const COMMENT_MARKER_PREFIX_RE = /^\s*(?:\/\/+|\/\*+|\*+)?\s*/;
const COMMENT_CLOSE_SUFFIX_RE = /(?<!\s)\s*\*\/\s*(?:\}\s*)?$/;

export type CommentLine = { readonly line: number; readonly body: string };

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = text.indexOf("\n", from); i !== -1 && i < to; i = text.indexOf("\n", i + 1)) count++;
  return count;
}

/** Every line of every comment in `fullText`, 1-based, with the comment markers stripped and trimmed. */
export function commentLines(fullText: string): CommentLine[] {
  const lines: CommentLine[] = [];
  let scannedUpTo = 0;
  let firstLine = 1;
  for (const comment of scanCommentTrivia(fullText)) {
    firstLine += countNewlines(fullText, scannedUpTo, comment.start);
    scannedUpTo = comment.start;
    for (const [offset, rawLine] of comment.text.split("\n").entries()) {
      const body = rawLine
        .replace(COMMENT_MARKER_PREFIX_RE, "")
        .replace(COMMENT_CLOSE_SUFFIX_RE, "")
        .trim();
      lines.push({ line: firstLine + offset, body });
    }
  }
  return lines;
}
