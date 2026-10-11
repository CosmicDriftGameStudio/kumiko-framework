import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type UiStringSources = {
  repoDir: string;
  locales: readonly string[];
  globs: readonly string[];
  packages: ReadonlyArray<{
    package: string;
    files: readonly string[];
    locale?: string;
  }>;
};

const PLACEHOLDER = "\u0001";
const QUOTES = /[„“”"'’‘‚«»‹›`]/g;
const WORD_CHAR = "\\p{L}\\p{N}";

function unescapeLiteral(raw: string): string {
  return raw.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_, code: string) => {
      if (code.startsWith("u{"))
        return String.fromCodePoint(Number.parseInt(code.slice(2, -1), 16));
      if (code.startsWith("u") && code.length === 5)
        return String.fromCharCode(Number.parseInt(code.slice(1), 16));
      if (code.startsWith("x") && code.length === 3)
        return String.fromCharCode(Number.parseInt(code.slice(1), 16));
      if (code === "n") return "\n";
      if (code === "t") return "\t";
      return code;
    },
  );
}

export function readStringLiteral(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (quote === "`" && char === "$" && source[index + 1] === "{") return undefined;
    if (char === quote) {
      return {
        value: unescapeLiteral(source.slice(start + 1, index)),
        end: index + 1,
      };
    }
    if (char === "\n" && quote !== "`") return undefined;
    index++;
  }
  return undefined;
}

export type UiStringMap = Map<string, string[]>;

function push(map: UiStringMap, locale: string, value: string): void {
  const list = map.get(locale);
  if (list) list.push(value);
  else map.set(locale, [value]);
}

export function extractUiStrings(
  source: string,
  locales: readonly string[],
  flatLocale?: string,
): UiStringMap {
  const result: UiStringMap = new Map();
  const alternatives = locales.map((locale) => locale.replace(/[^\w-]/g, "")).join("|");
  if (!alternatives) return result;

  for (const match of source.matchAll(new RegExp(`\\b(${alternatives})\\s*:\\s*(?=["'\`])`, "g"))) {
    const locale = match[1];
    const literal = locale ? readStringLiteral(source, match.index + match[0].length) : undefined;
    if (locale && literal) push(result, locale, literal.value);
  }

  const blocks = [
    ...source.matchAll(new RegExp(`^[ \\t]*["']?(${alternatives})["']?\\s*:\\s*\\{`, "gm")),
  ].map((match) => ({ at: match.index, locale: match[1] }));
  if (flatLocale === undefined && blocks.length === 0) return result;
  for (const match of source.matchAll(/(?:["'][^"'\n]+["']|[A-Za-z_$][\w$]*)\s*:\s*(?=["'`])/g)) {
    const valueStart = match.index + match[0].length;
    const block = [...blocks].reverse().find((candidate) => candidate.at < match.index);
    const locale = flatLocale ?? block?.locale;
    const literal = locale ? readStringLiteral(source, valueStart) : undefined;
    if (locale && literal) push(result, locale, literal.value);
  }
  return result;
}

export function normalizeUiTerm(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, PLACEHOLDER)
    .replace(QUOTES, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(
      new RegExp(`^[^${WORD_CHAR}${PLACEHOLDER}]+|[^${WORD_CHAR}${PLACEHOLDER}]+$`, "gu"),
      "",
    );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasLiteralWordsAroundPlaceholder(value: string): boolean {
  return (
    value.includes(PLACEHOLDER) &&
    value.replace(new RegExp(`[^${WORD_CHAR}]`, "gu"), "").length >= 3
  );
}

type LocaleIndex = {
  exact: Set<string>;
  haystack: string;
  wildcards: RegExp[];
};
export type UiIndex = { locales: ReadonlyMap<string, LocaleIndex> };

export function buildUiIndex(strings: UiStringMap): UiIndex {
  const locales = new Map<string, LocaleIndex>();
  for (const [locale, values] of strings) {
    const normalized = [...new Set(values.map(normalizeUiTerm).filter(Boolean))];
    locales.set(locale, {
      exact: new Set(normalized),
      haystack: normalized.join("\n"),
      wildcards: normalized
        .filter(hasLiteralWordsAroundPlaceholder)
        .map(
          (value) => new RegExp(`^${value.split(PLACEHOLDER).map(escapeRegex).join(".+")}$`, "u"),
        ),
    });
  }
  return { locales };
}

export function hasUiStrings(index: UiIndex, locale: string): boolean {
  return (index.locales.get(locale)?.exact.size ?? 0) > 0;
}

export function uiIndexContains(index: UiIndex, locale: string, term: string): boolean {
  const localeIndex = index.locales.get(locale);
  const normalized = normalizeUiTerm(term);
  if (!localeIndex || !normalized) return true;
  if (localeIndex.exact.has(normalized)) return true;
  if (localeIndex.wildcards.some((pattern) => pattern.test(normalized))) return true;
  const wholeWord = new RegExp(
    `(?<![${WORD_CHAR}])${escapeRegex(normalized)}(?![${WORD_CHAR}])`,
    "u",
  );
  return wholeWord.test(localeIndex.haystack);
}

export function extractBoldTerms(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  const terms = new Set<string>();
  for (const match of withoutCode.matchAll(/(?<!\*)\*\*(?!\*)((?:[^*\n]|\n(?!\n))+?)\*\*(?!\*)/g)) {
    const term = (match[1] ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim();
    if (/[\p{L}\p{N}]/u.test(term)) terms.add(term);
  }
  return [...terms];
}

export function findMissingUiTerms(
  markdown: string,
  locale: string,
  index: UiIndex,
  ignore: readonly string[],
): string[] {
  if (!hasUiStrings(index, locale)) return [];
  const ignored = new Set(ignore.map(normalizeUiTerm));
  return extractBoldTerms(markdown).filter(
    (term) => !ignored.has(normalizeUiTerm(term)) && !uiIndexContains(index, locale, term),
  );
}

function packageDirectory(packageName: string, fromDir: string): string | undefined {
  try {
    // Bare-name resolution fails for packages without a "." export (bundled-features).
    let current = dirname(Bun.resolveSync(`${packageName}/package.json`, fromDir));
    while (current !== dirname(current)) {
      const manifest = join(current, "package.json");
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === packageName) {
        return current;
      }
      current = dirname(current);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function scanFiles(cwd: string, patterns: readonly string[]): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(pattern).scanSync({
      cwd,
      onlyFiles: true,
    })) {
      // A pattern that names __tests__ opts in (the framework's en catalog
      // snapshot is the only English source for its UI strings).
      const testsAllowed = pattern.includes("__tests__");
      if (
        !/(^|\/)node_modules\//.test(file) &&
        (testsAllowed || !/(^|\/)__tests__\//.test(file)) &&
        !/\.test\.tsx?$/.test(file)
      ) {
        files.add(join(cwd, file));
      }
    }
  }
  return [...files].sort();
}

export function extractYamlStrings(source: string): string[] {
  const values: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s+)?(?:[\w-]+:\s+)?(["']?)(.+?)\1\s*$/);
    const value = match?.[2];
    if (!value || /^[\w-]+:$/.test(value) || /^[|>][+-]?$/.test(value) || value.startsWith("#"))
      continue;
    values.push(value);
  }
  return values;
}

export function collectYamlUiStrings(
  repoDir: string,
  byLocale: Readonly<Record<string, readonly string[]>>,
): UiStringMap {
  const merged: UiStringMap = new Map();
  for (const [locale, globs] of Object.entries(byLocale)) {
    for (const file of scanFiles(repoDir, globs)) {
      const source = readFileSync(file, "utf8");
      // Non-YAML files (.md, .astro) are raw haystacks, no markup parsing.
      const values = /\.ya?ml$/.test(file) ? extractYamlStrings(source) : [source];
      for (const value of values) push(merged, locale, value);
    }
  }
  return merged;
}

export function collectSourceUiStrings(
  repoDir: string,
  globs: readonly string[],
  locales: readonly string[],
): UiStringMap {
  const merged: UiStringMap = new Map();
  for (const file of scanFiles(repoDir, globs)) {
    const found = extractUiStrings(readFileSync(file, "utf8"), locales);
    for (const [locale, values] of found) for (const value of values) push(merged, locale, value);
  }
  return merged;
}

export function collectUiStrings(sources: UiStringSources): UiStringMap {
  const merged: UiStringMap = new Map();
  const absorb = (files: string[], flatLocale?: string) => {
    for (const file of files) {
      const found = extractUiStrings(readFileSync(file, "utf8"), sources.locales, flatLocale);
      for (const [locale, values] of found) for (const value of values) push(merged, locale, value);
    }
  };
  absorb(scanFiles(sources.repoDir, sources.globs));
  for (const entry of sources.packages) {
    const directory = packageDirectory(entry.package, sources.repoDir);
    if (directory) absorb(scanFiles(directory, entry.files), entry.locale);
  }
  return merged;
}
