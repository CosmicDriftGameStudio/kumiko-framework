// First-run welcome banner for `runDevApp({ welcomeBanner: true })`.
// Opt-in only — `bun dev` should not normalize this for apps that
// already log their own startup. Scaffolded apps (create-kumiko-app)
// flip it on so the first `bun dev` doesn't end on "Server läuft" with
// the user wondering where to click.

export type WelcomeBannerInput = {
  /** Resolved listen-URL (`http://localhost:3000`). */
  readonly url: string;
  /** Login the seeded admin uses (from runDevApp options.auth.admin). */
  readonly admin?: { readonly email: string; readonly password: string };
  /** Hot-reload hint shown in the "add a feature" line. Defaults to
   *  `src/features/`. */
  readonly featuresDir?: string;
  /** Custom docs URL — defaults to the public docs site. */
  readonly docsUrl?: string;
};

export function renderWelcomeBanner(input: WelcomeBannerInput): string {
  const featuresDir = input.featuresDir ?? "src/features/";
  const docsUrl = input.docsUrl ?? "https://docs.kumiko.rocks/quickstart";

  const lines: string[] = [];
  lines.push(`✓ kumiko-app läuft`);
  lines.push(`→ Browser:        ${input.url}`);
  if (input.admin) {
    lines.push(`→ Login als:      ${input.admin.email} / ${input.admin.password}`);
  }
  lines.push(`→ Feature add:    edit ${featuresDir}`);
  lines.push(`→ Docs:           ${docsUrl}`);

  const innerWidth = Math.max(...lines.map((l) => stringWidth(l)));
  const border = "─".repeat(innerWidth + 2);
  const top = `┌${border}┐`;
  const bottom = `└${border}┘`;
  const padded = lines.map((l) => `│ ${l}${" ".repeat(innerWidth - stringWidth(l))} │`);
  return [top, ...padded, bottom].join("\n");
}

// ponytail: codepoint width; ok for ASCII + arrows, add a width-lib if CJK ever lands here.
function stringWidth(s: string): number {
  return [...s].length;
}
