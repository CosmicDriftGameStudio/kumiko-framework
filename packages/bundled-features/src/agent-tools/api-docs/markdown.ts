const TABLE_CELL_BREAKS = /\s*[\r\n]+\s*/g;

export function escapeCell(text: string): string {
  return text.replace(TABLE_CELL_BREAKS, " ").replace(/\|/g, "\\|");
}

export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

/** Code span that survives backticks inside the text. */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  return longestRun > 0 ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

export function fenced(language: string, body: string): string {
  return [`\`\`\`${language}`, body, "```"].join("\n");
}

/** Only `title` and `description`: the markdown must stay valid for any static-site tooling. */
export function frontmatter(title: string, description: string): string {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
  ].join("\n");
}

/** Blocks joined by blank lines; the file ends with exactly one newline. */
export function joinBlocks(blocks: readonly string[]): string {
  return `${blocks.filter((block) => block !== "").join("\n\n")}\n`;
}

export type PageAnchor = {
  readonly id: string;
  /** The heading text exactly as rendered. */
  readonly heading: string;
  readonly level: 2 | 3;
  readonly qn?: string;
};

export type RenderedPage = {
  readonly title: string;
  readonly description: string;
  readonly content: string;
  readonly anchors: readonly PageAnchor[];
};

/** Collects blocks and, for every heading, an anchor entry: the ids stay in index.json
 *  instead of the heading so they are the same in every language. */
export function pageBuilder(title: string, description: string) {
  const blocks: string[] = [frontmatter(title, description)];
  const anchors: PageAnchor[] = [];
  return {
    add(...more: readonly string[]): void {
      blocks.push(...more);
    },
    section(id: string, heading: string, level: 2 | 3 = 2, qn?: string): void {
      blocks.push(`${"#".repeat(level)} ${heading}`);
      anchors.push({ id, heading, level, ...(qn !== undefined && { qn }) });
    },
    finish(): RenderedPage {
      return { title, description, content: joinBlocks(blocks), anchors };
    },
  };
}
