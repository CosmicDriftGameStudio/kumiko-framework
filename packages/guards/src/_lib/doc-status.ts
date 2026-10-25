import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RepoRoot } from "./roots";

export const DOC_STATUSES = [
  "shipped",
  "in-progress",
  "blocked",
  "parked",
  "idea",
  "unknown",
  "superseded",
  "reference",
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number];

export type DocFrontmatter = {
  readonly status: DocStatus;
  readonly verified: string;
  readonly issue?: string;
  readonly depends?: readonly string[];
};

export type StatusDoc = {
  readonly relPath: string;
  readonly frontmatter: DocFrontmatter | undefined;
  readonly problems: readonly string[];
};

export const DOC_DIRS: readonly string[] = [
  "docs/plans",
  "docs/runbooks",
  "docs/migration",
  "docs/reference",
];

// templates/ would leak frontmatter into the files generated from them,
// marketing/ is site copy, archive/ holds finished plans.
const EXCLUDED_SEGMENTS: readonly string[] = ["templates", "node_modules", "marketing", "archive"];

// Status overviews generated from the plan docs carry no frontmatter themselves.
const GENERATED_PLAN_INDEXES = new Set(["docs/plans/STATUS.md", "docs/plans/ROADMAP.md"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDocStatus(value: string): value is DocStatus {
  return DOC_STATUSES.some((status) => status === value);
}

function parseInlineList(raw: string | undefined): readonly string[] | undefined {
  if (!raw) return undefined;
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const items = inner
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

// Anchored on purpose: an unanchored `word#digits` would turn a doc path such
// as `rfc#42.md` into a phantom issue reference.
export function isDependsRef(ref: string): boolean {
  return /^(?:[\w.-]+\/)?[\w.-]+#\d+(?:\s+\(.*\))?$/.test(ref) || /^[\w.-]+:.+\.md$/.test(ref);
}

type ParsedFrontmatter = Pick<StatusDoc, "frontmatter" | "problems">;

function invalid(problem: string): ParsedFrontmatter {
  return { frontmatter: undefined, problems: [problem] };
}

function readFields(
  block: string,
): { fields: Map<string, string>; dependsItems?: string[] } | string {
  const fields = new Map<string, string>();
  let lastKey: string | undefined;
  let dependsItems: string[] | undefined;
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Bullets before the `:` split, so `- repo:docs/x.md` never becomes a field.
    if (trimmed.startsWith("- ")) {
      if (lastKey !== "depends") {
        return `block list item under '${lastKey ?? "<no field>"}', only 'depends' takes a list: ${trimmed}`;
      }
      dependsItems ??= [];
      dependsItems.push(
        trimmed
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, ""),
      );
      continue;
    }
    const sep = line.indexOf(":");
    if (sep < 0) return `frontmatter line without 'key: value': ${trimmed}`;
    lastKey = line.slice(0, sep).trim();
    fields.set(lastKey, line.slice(sep + 1).trim());
  }
  return { fields, dependsItems };
}

function statusDependentFieldProblems(status: string, fields: Map<string, string>): string[] {
  const problems: string[] = [];
  if (status === "shipped" && !fields.get("evidence")) {
    problems.push(
      "status 'shipped' needs evidence (PR, release or commit), otherwise use 'unknown'",
    );
  }
  if (status === "superseded" && !fields.get("superseded-by")) {
    problems.push("status 'superseded' needs superseded-by");
  }
  if ((status === "in-progress" || status === "blocked") && !fields.get("next")) {
    problems.push(`status '${status}' needs next (one line)`);
  }
  return problems;
}

export function parseStatusFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---\n"))
    return invalid("no status frontmatter (file must start with '---')");
  const end = content.indexOf("\n---", 4);
  if (end < 0) return invalid("frontmatter is not closed (second '---' missing)");
  const read = readFields(content.slice(4, end));
  if (typeof read === "string") return invalid(read);
  const { fields, dependsItems } = read;

  const problems: string[] = [];
  const status = fields.get("status") ?? "";
  const verified = fields.get("verified") ?? "";
  if (!isDocStatus(status)) {
    problems.push(
      `status '${status || "<empty>"}' is invalid, allowed: ${DOC_STATUSES.join(", ")}`,
    );
  }
  if (!ISO_DATE.test(verified)) {
    problems.push(`verified '${verified || "<empty>"}' is not an ISO date (YYYY-MM-DD)`);
  }
  problems.push(...statusDependentFieldProblems(status, fields));
  if (problems.length > 0 || !isDocStatus(status)) return { frontmatter: undefined, problems };
  return {
    frontmatter: {
      status,
      verified,
      issue: fields.get("issue"),
      depends: dependsItems ?? parseInlineList(fields.get("depends")),
    },
    problems: [],
  };
}

export function statusDocHygieneWarnings(doc: StatusDoc): readonly string[] {
  const fm = doc.frontmatter;
  if (!fm) return [];
  const warnings: string[] = [];
  if ((fm.status === "in-progress" || fm.status === "blocked") && !fm.issue?.trim()) {
    warnings.push(
      `status '${fm.status}' without issue: an active spec names its issue in the frontmatter`,
    );
  }
  if (
    (fm.status === "shipped" || fm.status === "superseded") &&
    doc.relPath.startsWith("docs/plans/")
  ) {
    warnings.push("shipped/superseded doc in docs/plans/: move it to docs/archive/plans/");
  }
  for (const ref of fm.depends ?? []) {
    if (!isDependsRef(ref)) {
      warnings.push(`depends '${ref}' is neither 'repo#issue' nor 'repo:path.md'`);
    }
  }
  return warnings;
}

function collectMarkdownFiles(dir: string, walkRoot: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    // Segments below the walk root only: a checkout under ~/marketing/ must not hide every doc.
    if (
      relative(walkRoot, abs)
        .split("/")
        .some((segment) => EXCLUDED_SEGMENTS.includes(segment))
    ) {
      continue;
    }
    if (statSync(abs).isDirectory()) collectMarkdownFiles(abs, walkRoot, out);
    else if (name.endsWith(".md")) out.push(abs);
  }
}

export function discoverStatusDocs(root: RepoRoot): StatusDoc[] {
  const docs: StatusDoc[] = [];
  for (const docDir of DOC_DIRS) {
    const absDir = join(root.absPath, docDir);
    if (!existsSync(absDir)) continue;
    const files: string[] = [];
    collectMarkdownFiles(absDir, absDir, files);
    for (const absPath of files) {
      const relPath = relative(root.absPath, absPath);
      if (GENERATED_PLAN_INDEXES.has(relPath)) continue;
      docs.push({ relPath, ...parseStatusFrontmatter(readFileSync(absPath, "utf-8")) });
    }
  }
  return docs;
}
