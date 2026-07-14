export type LlmsTxtLink = {
  readonly title: string;
  readonly url: string;
  readonly desc?: string;
};

export type LlmsTxtSection = {
  readonly heading: string;
  readonly links: readonly LlmsTxtLink[];
};

export type LlmsTxtInput = {
  readonly title: string;
  readonly summary: string;
  readonly sections?: readonly LlmsTxtSection[];
};

// Plain-text builder for the community llms.txt convention (H1 title,
// blockquote summary, `## `-headed link lists). No HTML escaping needed —
// Markdown link syntax, plain-text output.
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const sections = (input.sections ?? [])
    .filter((s) => s.links.length > 0)
    .map((s) => {
      const links = s.links
        .map((l) => `- [${l.title}](${l.url})${l.desc ? `: ${l.desc}` : ""}`)
        .join("\n");
      return `## ${s.heading}\n\n${links}`;
    })
    .join("\n\n");
  const summary = input.summary ? `\n\n> ${input.summary}` : "";
  return `# ${input.title}${summary}${sections ? `\n\n${sections}` : ""}\n`;
}
