import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GUARDS_DOC_REL = "docs/reference/guards.md";
export const GUARDS_SRC_REL = "packages/guards/src";

const GUARD_FILE_RE = /^(guard|check)-.+\.ts$/;
const IGNORE_KEY_RE = /kumiko-lint-ignore ([a-z][a-z0-9-]*)/g;
const FRONT_MATTER_VERIFIED = "2026-10-20";

function headerComment(source: string): string {
  const lines = source.split("\n").filter((line) => !line.startsWith("#!"));
  const body: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (text === "" && body.length === 0) continue;
    if (
      text.startsWith("/**") ||
      text.startsWith("/*") ||
      text.startsWith("*") ||
      text.startsWith("//")
    ) {
      body.push(
        text
          .replace(/^(\/\*\*?|\*\/|\*|\/\/)\s?/, "")
          .replace(/\*\/$/, "")
          .trim(),
      );
      if (text.endsWith("*/")) break;
      continue;
    }
    break;
  }
  return body.join("\n");
}

function purposeOf(source: string): string {
  const paragraph = headerComment(source).split(/\n\s*\n/)[0] ?? "";
  const flat = paragraph.replace(/\s+/g, " ").trim();
  const sentenceEnd = flat.search(/\.(\s|$)/);
  const sentence = sentenceEnd === -1 ? flat : flat.slice(0, sentenceEnd + 1);
  return sentence.replace(/\|/g, "\\|") || "-";
}

function ignoreKeysOf(source: string): string[] {
  return [...new Set([...source.matchAll(IGNORE_KEY_RE)].map((match) => match[1] ?? ""))].sort();
}

export function guardSourceFiles(frameworkRoot: string): string[] {
  return readdirSync(join(frameworkRoot, GUARDS_SRC_REL))
    .filter((file) => GUARD_FILE_RE.test(file))
    .sort();
}

export function renderGuardsDoc(frameworkRoot: string): string {
  const rows = guardSourceFiles(frameworkRoot).map((file) => {
    const source = readFileSync(join(frameworkRoot, GUARDS_SRC_REL, file), "utf-8");
    const keys = ignoreKeysOf(source);
    const suppress =
      keys.length === 0 ? "-" : keys.map((key) => `\`kumiko-lint-ignore ${key}\``).join(", ");
    return `| \`${file.replace(/\.ts$/, "")}\` | ${purposeOf(source)} | ${suppress} |`;
  });
  return [
    "---",
    "status: reference",
    `verified: ${FRONT_MATTER_VERIFIED}`,
    `evidence: "generated from ${GUARDS_SRC_REL}/{guard,check}-*.ts by scripts/gen-guards-doc.ts; drift is enforced by the guards-doc-drift check"`,
    "---",
    "",
    "# Guards",
    "",
    "Generated, do not edit. Run `bun run gen:guards-doc` after adding or changing a guard.",
    "Purpose is the first sentence of the guard's header comment; the suppression column lists",
    "the `kumiko-lint-ignore <key>` markers the guard honors (`-` = not suppressible inline).",
    "",
    "| Guard | Purpose | Suppression |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function writeGuardsDoc(frameworkRoot: string): void {
  writeFileSync(join(frameworkRoot, GUARDS_DOC_REL), renderGuardsDoc(frameworkRoot), "utf-8");
}

export function hasGuardsSource(frameworkRoot: string): boolean {
  return existsSync(join(frameworkRoot, GUARDS_SRC_REL));
}
