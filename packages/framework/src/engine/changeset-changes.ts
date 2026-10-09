import { type ChangelogType, validateChangelog } from "./feature-changelog.js";

export type PendingChange = {
  readonly feature: string;
  readonly type: ChangelogType;
  readonly title: string;
  readonly detail?: string;
  readonly migration?: string;
  readonly codemod?: string;
  readonly manualAfterCodemod?: boolean;
  readonly source: string;
};

const BLOCK_RE = /<!--\s*kumiko-changes\s*\n([\s\S]*?)\n\s*-->/g;
const TYPE_VALUES = new Set<ChangelogType>(["breaking", "improvement", "fix"]);
const KEY_RE = /^(feature|type|title|detail|migration|codemod|manualAfterCodemod):(?:\s(.*))?$/;

function requiredField(fields: ReadonlyMap<string, string>, field: string, source: string): string {
  const value = fields.get(field)?.trim();
  if (!value) throw new Error(`${source}: kumiko-changes ${field} is required`);
  return value;
}

function parseBlock(raw: string, source: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const lines = raw.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const match = KEY_RE.exec(line.trim());
    if (!match) throw new Error(`${source}: invalid kumiko-changes line "${line.trim()}"`);

    const key = match[1];
    if (!key) throw new Error(`${source}: invalid kumiko-changes field`);
    if (fields.has(key)) throw new Error(`${source}: duplicate kumiko-changes field "${key}"`);
    const value = match[2];
    if (value === "|") {
      const continuation: string[] = [];
      // A blank line inside the block is a paragraph break, not the end of it;
      // stopping on the first one truncated the field and then threw a
      // misleading "invalid line" error on the next indented line, which no
      // longer looked like a `key: value` pair on its own.
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (next.startsWith("  ")) {
          index++;
          continuation.push(next.slice(2));
          continue;
        }
        if (next.trim() === "") {
          index++;
          continuation.push("");
          continue;
        }
        break;
      }
      fields.set(key, continuation.join("\n").trim());
      continue;
    }
    fields.set(key, value ?? "");
  }

  return fields;
}

function proseWithoutMetadata(markdown: string): string[] {
  const withoutFrontmatter = markdown.replace(/^\s*---\n[\s\S]*?\n---\s*/, "");
  return withoutFrontmatter
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function sameTitle(title: string, line: string | undefined): boolean {
  const normalize = (text: string) => text.replace(/[.\s]+$/, "").toLowerCase();
  return line !== undefined && normalize(title) === normalize(line);
}

// BLOCK_RE closes at the first line starting with "-->"; text after it on
// that line means a field value contained one and the block ended early.
function assertBlockNotClosedEarly(markdown: string, match: RegExpExecArray, source: string): void {
  const restOfLine = markdown.slice(match.index + match[0].length).split("\n", 1)[0] ?? "";
  if (restOfLine.trim() !== "") {
    throw new Error(
      `${source}: kumiko-changes block closed early by a line starting with "-->"; field values must not contain such a line`,
    );
  }
}

function resolveTitleAndDetail(
  fields: ReadonlyMap<string, string>,
  prose: readonly string[],
  source: string,
): { readonly title: string; readonly detail: string } {
  const explicitTitle = fields.get("title")?.trim();
  const title = explicitTitle || prose[0];
  if (!title) throw new Error(`${source}: kumiko-changes title is required`);

  // The first prose line is the title's source only when no title was given or
  // the explicit one restates it; otherwise it is genuine detail.
  const firstLineIsTitle = !explicitTitle || sameTitle(explicitTitle, prose[0]);
  const detail =
    fields.get("detail")?.trim() ||
    prose
      .slice(firstLineIsTitle ? 1 : 0)
      .join("\n")
      .trim();
  return { title, detail };
}

function parseManualAfterCodemod(fields: ReadonlyMap<string, string>, source: string): boolean {
  const raw = fields.get("manualAfterCodemod")?.trim();
  if (raw !== undefined && raw !== "true" && raw !== "false") {
    throw new Error(`${source}: kumiko-changes manualAfterCodemod must be true or false`);
  }
  return raw === "true";
}

function buildChange(
  fields: ReadonlyMap<string, string>,
  prose: readonly string[],
  source: string,
): PendingChange {
  const feature = requiredField(fields, "feature", source);
  const rawType = requiredField(fields, "type", source);
  if (!TYPE_VALUES.has(rawType as ChangelogType)) {
    throw new Error(`${source}: kumiko-changes type must be breaking, improvement, or fix`);
  }
  const { title, detail } = resolveTitleAndDetail(fields, prose, source);
  const migration = fields.get("migration")?.trim();
  const codemod = fields.get("codemod")?.trim();
  const manualAfterCodemod = parseManualAfterCodemod(fields, source);
  const change: PendingChange = {
    feature,
    type: rawType as ChangelogType,
    title,
    ...(detail ? { detail } : {}),
    ...(migration ? { migration } : {}),
    ...(codemod ? { codemod } : {}),
    ...(manualAfterCodemod ? { manualAfterCodemod: true } : {}),
    source,
  };
  const validation = validateChangelog({ version: "0.0.0", ...change });
  if (validation.length > 0) throw new Error(`${source}: ${validation.join("; ")}`);
  return change;
}

/** Parse structured upgrade metadata embedded in a Changeset body. */
export function parseChangesetChanges(markdown: string, source: string): readonly PendingChange[] {
  const changes: PendingChange[] = [];
  // Each block only inherits prose from the markdown between the previous block
  // and itself; document-wide prose would give two features the same title.
  let segmentStart = 0;
  BLOCK_RE.lastIndex = 0;
  let match = BLOCK_RE.exec(markdown);
  while (match !== null) {
    const block = match[1];
    const prose = proseWithoutMetadata(markdown.slice(segmentStart, match.index));
    segmentStart = match.index + match[0].length;
    assertBlockNotClosedEarly(markdown, match, source);
    if (!block) throw new Error(`${source}: empty kumiko-changes block`);
    const change = buildChange(parseBlock(block, source), prose, source);
    changes.push(change);
    match = BLOCK_RE.exec(markdown);
  }

  return changes;
}
