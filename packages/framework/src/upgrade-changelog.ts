import type { UpgradeMarkerResolvedManual } from "./upgrade-marker-parse.ts";

// CHANGELOG.md in the app root, written by `kumiko-upgrade --apply`: one
// "Keep a Changelog" section per bump, newest first.
export type UpgradeChangelogManual = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly status: "open" | "migrated" | "not-applicable";
};

export type UpgradeChangelogSection = {
  readonly from: string;
  readonly to: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly breaking: readonly { readonly version: string; readonly title: string }[];
  readonly manual: readonly UpgradeChangelogManual[];
  readonly codemods: readonly {
    readonly version: string;
    readonly codemod: string;
    readonly title: string;
  }[];
};

const CHANGELOG_HEADER = `# Changelog

Kumiko upgrades of this app, written by \`kumiko-upgrade --apply\`. Newest first.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`;
const SECTION_START = /^## \[/;
const PACKAGES_LABEL = "@cosmicdrift/kumiko-*";

function printableLine(text: string): string {
  return text.replace(/\p{Cc}/gu, " ");
}

function bulletList(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ["", `### ${title}`, "", ...lines.map((line) => `- ${line}`)];
}

export function renderUpgradeSection(section: UpgradeChangelogSection): string {
  return [
    `## [${section.to}] - ${section.date}`,
    ...bulletList("Changed", [`${PACKAGES_LABEL}: ${section.from} → ${section.to}`]),
    ...bulletList(
      "Breaking",
      section.breaking.map((entry) => `${entry.version} · ${printableLine(entry.title)}`),
    ),
    ...bulletList(
      "Manual migrations",
      section.manual.map(
        (entry) =>
          `[${entry.status}] ${entry.id} · ${entry.version} · ${printableLine(entry.title)}`,
      ),
    ),
    ...bulletList(
      "Codemods applied",
      section.codemods.map(
        (entry) => `${entry.version} · ${entry.codemod} · ${printableLine(entry.title)}`,
      ),
    ),
    "",
  ].join("\n");
}

function splitSections(content: string): { header: string; sections: string[] } {
  const lines = content.split("\n");
  const firstSection = lines.findIndex((line) => SECTION_START.test(line));
  if (firstSection === -1) return { header: content.replace(/\n*$/, "\n"), sections: [] };
  const header = lines.slice(0, firstSection).join("\n").replace(/\n*$/, "\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines.slice(firstSection)) {
    if (SECTION_START.test(line) && current.length > 0) {
      sections.push(current.join("\n").replace(/\n*$/, "\n"));
      current = [];
    }
    current.push(line);
  }
  sections.push(current.join("\n").replace(/\n*$/, "\n"));
  return { header, sections };
}

/** Puts the section on top; a section for the same target version is replaced, so a re-run stays idempotent. */
export function mergeUpgradeSection(
  existing: string | undefined,
  section: UpgradeChangelogSection,
): string {
  const { header, sections } = splitSections(existing ?? CHANGELOG_HEADER);
  const prefix = `## [${section.to}]`;
  const others = sections.filter((candidate) => !candidate.startsWith(prefix));
  return [header, renderUpgradeSection(section), ...others].join("\n");
}

/** Pure string match on the rendered `- [open] <id> · ` prefix, in every section; each id gets its own resolution. */
export function syncResolvedManualStatuses(
  content: string,
  resolved: readonly Pick<UpgradeMarkerResolvedManual, "id" | "resolution">[],
): string {
  const resolutionById = new Map(resolved.map((entry) => [entry.id, entry.resolution]));
  if (resolutionById.size === 0) return content;
  const openPrefix = "- [open] ";
  return content
    .split("\n")
    .map((line) => {
      if (!line.startsWith(openPrefix)) return line;
      const rest = line.slice(openPrefix.length);
      const idEnd = rest.indexOf(" · ");
      const resolution = idEnd === -1 ? undefined : resolutionById.get(rest.slice(0, idEnd));
      return resolution === undefined ? line : `- [${resolution}] ${rest}`;
    })
    .join("\n");
}
