import { type ChangelogType, validateChangelog } from "./feature-changelog";

export type PendingChange = {
  readonly feature: string;
  readonly type: ChangelogType;
  readonly title: string;
  readonly detail?: string;
  readonly migration?: string;
  readonly codemod?: string;
  readonly source: string;
};

const BLOCK_RE = /<!--\s*kumiko-changes\s*\n([\s\S]*?)\n\s*-->/g;
const TYPE_VALUES = new Set<ChangelogType>(["breaking", "improvement", "fix"]);
const KEY_RE = /^(feature|type|title|detail|migration|codemod):(?:\s(.*))?$/;

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
    .replace(BLOCK_RE, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Parse structured upgrade metadata embedded in a Changeset body. */
export function parseChangesetChanges(markdown: string, source: string): readonly PendingChange[] {
  const changes: PendingChange[] = [];
  const prose = proseWithoutMetadata(markdown);
  BLOCK_RE.lastIndex = 0;
  let match = BLOCK_RE.exec(markdown);
  while (match !== null) {
    const block = match[1];
    if (!block) throw new Error(`${source}: empty kumiko-changes block`);
    const fields = parseBlock(block, source);
    const feature = requiredField(fields, "feature", source);
    const rawType = requiredField(fields, "type", source);
    if (!TYPE_VALUES.has(rawType as ChangelogType)) {
      throw new Error(`${source}: kumiko-changes type must be breaking, improvement, or fix`);
    }
    const title = fields.get("title")?.trim() || prose[0];
    if (!title) throw new Error(`${source}: kumiko-changes title is required`);

    const detail =
      fields.get("detail")?.trim() ||
      prose
        .slice(prose.length > 0 ? 1 : 0)
        .join("\n")
        .trim();
    const migration = fields.get("migration")?.trim();
    const codemod = fields.get("codemod")?.trim();
    const change: PendingChange = {
      feature,
      type: rawType as ChangelogType,
      title,
      ...(detail ? { detail } : {}),
      ...(migration ? { migration } : {}),
      ...(codemod ? { codemod } : {}),
      source,
    };
    const validation = validateChangelog({ version: "0.0.0", ...change });
    if (validation.length > 0) throw new Error(`${source}: ${validation.join("; ")}`);
    changes.push(change);
    match = BLOCK_RE.exec(markdown);
  }

  return changes;
}
