import { readFileSync } from "node:fs";

export type TextLineFinding = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

/** Collect lines of `abs` for which `predicate` is true. */
export function scanLinesForPredicate(
  abs: string,
  fileLabel: string,
  predicate: (line: string) => boolean,
  into: TextLineFinding[] = [],
): TextLineFinding[] {
  const lines = readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (predicate(line)) {
      into.push({ file: fileLabel, line: i + 1, text: line.trim() });
    }
  }
  return into;
}
