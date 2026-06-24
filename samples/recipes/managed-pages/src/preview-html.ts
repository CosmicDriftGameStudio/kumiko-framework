import type { BrandingTokens } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import {
  renderSafeMarkdown,
  wrapInLayout,
} from "@cosmicdrift/kumiko-bundled-features/page-render";

const ABOUT_MARKDOWN = [
  "# About Acme Inc",
  "",
  "We run internal ops on **Kumiko** — one instance, two workspaces, tenant-scoped data.",
  "",
  "## What we publish here",
  "",
  "- **Public pages** edited by tenant admins (Markdown, no deploy)",
  "- **Branding** via config keys — accent color, site title, optional custom CSS",
  "- **Per-tenant isolation** — `Vary: Host` keeps CDN caches honest",
  "",
  "## Team",
  "",
  "| Role | Focus |",
  "|---|---|",
  "| Platform | Kumiko features, billing, compliance |",
  "| Operations | Asset tracker + helpdesk on one stack |",
  "| Support | SLA-backed responses for Pro tenants |",
  "",
  "## Contact",
  "",
  "Questions about this page or your tenant setup? [support@acme.example](mailto:support@acme.example)",
].join("\n");

const PREVIEW_BRANDING: BrandingTokens = {
  title: "Acme Inc",
  description: "Internal tools on Kumiko — assets, tickets, and tenant pages",
  siteUrl: "https://acme.example",
  accentColor: "#6366f1",
  logoUrl: "",
  layoutPreset: "default",
  customCss: `[data-tenant-content] .callout{border-left:4px solid var(--accent);padding:1rem;background:#f8fafc;margin:1.5rem 0}`,
};

/** Branded public page with realistic tenant copy. */
export function getManagedAboutHtml(): string {
  return wrapInLayout({
    title: "About Acme",
    bodyHtml: renderSafeMarkdown(ABOUT_MARKDOWN),
    lang: "en",
    description: "How Acme uses managed-pages for tenant-editable marketing",
    branding: PREVIEW_BRANDING,
  });
}
