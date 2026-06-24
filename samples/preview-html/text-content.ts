import { renderSafeMarkdown, wrapInLayout } from "@cosmicdrift/kumiko-bundled-features/page-render";

const HELP_ARTICLE = [
  "# Getting started with your tenant",
  "",
  "This block is stored as **text-content** — keyed by `(tenant, slug, lang)` and editable without a deploy.",
  "",
  "## 1. Invite your team",
  "",
  "Tenant admins invite users via e-mail. Each member gets a role (`Admin`, `Editor`, `User`) that gates screens and writes.",
  "",
  "## 2. Configure caps",
  "",
  "Your plan limits projects and API volume. Upgrade in **Billing** when you hit soft caps — hard caps block writes with a clear error.",
  "",
  "## 3. Export your data",
  "",
  "Under **Privacy** you can request a ZIP export (GDPR Art. 20) or schedule deletion (Art. 17). Hooks are domain-specific; the framework ships the pipeline.",
  "",
  "> Tip: Seed default copy at boot with `seedTextBlock`, then let admins refine it in the entity editor.",
].join("\n");

/** CMS-style help article — illustrates text-content without legal-pages wrapper. */
export function getTextContentHelpHtml(): string {
  return wrapInLayout({
    title: "Help — Getting started",
    bodyHtml: renderSafeMarkdown(HELP_ARTICLE),
    lang: "en",
    description: "Editable marketing and help copy from the text-content feature",
  });
}
