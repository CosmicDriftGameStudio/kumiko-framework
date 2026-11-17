import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const GUARDS_DOC_REL = "docs/reference/guards.md";
const BIOME_RULES_REL = "packages/framework/presets/biome-rules.json";
export const GUARDS_SRC_REL = "packages/guards/src";

const GUARD_FILE_RE = /^(guard|check)-.+\.ts$/;
const IGNORE_KEY_RE = /kumiko-lint-ignore ([a-z][a-z0-9-]*)/g;
const FRONT_MATTER_VERIFIED = "2026-11-16";

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

// Abbreviations that end in a period but not the sentence.
const SENTENCE_END_RE = /(?<!\be\.g|\bi\.e|\bresp|\bz\. B|\bvs|\betc)\.(\s|$)/;

function purposeOf(source: string): string {
  const paragraph = headerComment(source).split(/\n\s*\n/)[0] ?? "";
  const flat = paragraph.replace(/\s+/g, " ").trim();
  const sentenceEnd = flat.search(SENTENCE_END_RE);
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

type PluginEntry = { readonly path: string; readonly includes: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPluginEntry(value: unknown): value is PluginEntry {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    Array.isArray(value["includes"]) &&
    value["includes"].every((glob) => typeof glob === "string")
  );
}

function parsePluginEntries(json: string): PluginEntry[] {
  const parsed: unknown = JSON.parse(json);
  const plugins = isRecord(parsed) ? parsed["plugins"] : undefined;
  if (!Array.isArray(plugins)) {
    throw new Error(`${BIOME_RULES_REL}: "plugins" must be an array`);
  }
  return plugins.map((entry, index) => {
    if (!isPluginEntry(entry)) {
      throw new Error(
        `${BIOME_RULES_REL}: plugins[${index}] needs a string "path" and a string[] "includes"`,
      );
    }
    return entry;
  });
}

const DIAGNOSTIC_MESSAGE_RE = /message="((?:[^"\\]|\\.)*)"/;

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentenceEnd = flat.search(SENTENCE_END_RE);
  return sentenceEnd === -1 ? flat : flat.slice(0, sentenceEnd + 1);
}

function pluginPurposeOf(grit: string): string {
  const message = DIAGNOSTIC_MESSAGE_RE.exec(grit)?.[1];
  if (message === undefined) return "-";
  return firstSentence(message.replace(/\\(.)/g, "$1")).replace(/\|/g, "\\|") || "-";
}

function pluginRows(frameworkRoot: string): string[] {
  const rulesFile = join(frameworkRoot, BIOME_RULES_REL);
  if (!existsSync(rulesFile)) return [];
  const includesByPlugin = new Map<string, Set<string>>();
  for (const entry of parsePluginEntries(readFileSync(rulesFile, "utf-8"))) {
    const globs = includesByPlugin.get(entry.path) ?? new Set<string>();
    for (const glob of entry.includes) if (!glob.startsWith("!")) globs.add(glob);
    includesByPlugin.set(entry.path, globs);
  }
  return [...includesByPlugin]
    .map(([pluginPath, globs]) => {
      const grit = readFileSync(join(frameworkRoot, dirname(BIOME_RULES_REL), pluginPath), "utf-8");
      const scope = [...globs].map((glob) => `\`${glob.replace(/\|/g, "\\|")}\``).join(", ");
      return { name: basename(pluginPath, ".grit"), purpose: pluginPurposeOf(grit), scope };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, purpose, scope }) => `| \`${name}\` | ${purpose} | ${scope || "-"} |`);
}

export function renderGuardsDoc(frameworkRoot: string): string {
  const rows = guardSourceFiles(frameworkRoot).map((file) => {
    const source = readFileSync(join(frameworkRoot, GUARDS_SRC_REL, file), "utf-8");
    const keys = ignoreKeysOf(source);
    const suppress =
      keys.length === 0 ? "-" : keys.map((key) => `\`kumiko-lint-ignore ${key}\``).join(", ");
    return `| \`${file.replace(/\.ts$/, "")}\` | ${purposeOf(source)} | ${suppress} |`;
  });
  const pluginTableRows = pluginRows(frameworkRoot);
  return [
    "---",
    "status: reference",
    `verified: ${FRONT_MATTER_VERIFIED}`,
    `evidence: "generated from ${GUARDS_SRC_REL}/{guard,check}-*.ts and ${BIOME_RULES_REL} + biome-plugins/*.grit by scripts/gen-guards-doc.ts; drift is enforced by the guards-doc-drift check"`,
    "---",
    "",
    "# Guards",
    "",
    "Generated, do not edit. Run `bun run gen:guards-doc` after adding or changing a guard.",
    "Purpose is the first sentence of the guard's header comment; the suppression column lists",
    "the `kumiko-lint-ignore <key>` markers the guard honors (`-` = not suppressible inline).",
    "A marker that suppresses nothing in a run fails the `unused-ignore-tags` check; delete it.",
    "",
    "| Guard | Purpose | Suppression |",
    "| --- | --- | --- |",
    ...rows,
    ...(pluginTableRows.length === 0
      ? []
      : [
          "",
          "## Biome plugins",
          "",
          `Generated from \`${BIOME_RULES_REL}\`. Purpose is the first sentence of the plugin's first diagnostic. Suppress a single finding with \`biome-ignore lint/plugin: <reason>\`; the security plugins (see the \`security-plugin-suppression\` guard) are not suppressible.`,
          "",
          "| Plugin | Purpose | Scope |",
          "| --- | --- | --- |",
          ...pluginTableRows,
        ]),
    "",
  ].join("\n");
}

export function writeGuardsDoc(frameworkRoot: string): void {
  writeFileSync(join(frameworkRoot, GUARDS_DOC_REL), renderGuardsDoc(frameworkRoot), "utf-8");
}

export function hasGuardsSource(frameworkRoot: string): boolean {
  return existsSync(join(frameworkRoot, GUARDS_SRC_REL));
}
