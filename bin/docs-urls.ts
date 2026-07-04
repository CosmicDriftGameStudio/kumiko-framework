// Canonical docs.kumiko.rocks URLs for the CLI (welcome block, `kumiko docs`, help).

export const DOCS_ORIGIN = "https://docs.kumiko.rocks";
export const DOCS_LOCALE = "en";

/** Locale-prefixed docs page, always trailing slash (matches Astro i18n routes). */
export function docsPageUrl(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${DOCS_ORIGIN}/${DOCS_LOCALE}/${trimmed}/`;
}

export function cliIndexUrl(): string {
  return docsPageUrl("cli");
}

/** `check:fast` → `/en/cli/commands/check-fast/` */
export function cliCommandDocUrl(commandId: string): string {
  const slug = commandId.replace(/:/g, "-");
  return docsPageUrl(`cli/commands/${slug}`);
}

export const WELCOME_DOC_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["Quickstart", docsPageUrl("quickstart/quickstart")],
  ["Walkthrough", docsPageUrl("walkthrough")],
  ["Concepts", docsPageUrl("concepts")],
  ["CLI reference", cliIndexUrl()],
];
