import {
  renderMarkdownToHtml,
  wrapInLayout,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";

const IMPRINT_MARKDOWN = [
  "## Provider information",
  "",
  "**Cosmic Drift Game Studio**",
  "Marc Frost",
  "Slevogtstr. 10",
  "04159 Leipzig",
  "Germany",
  "",
  "## Represented by",
  "",
  "Marc Frost (Managing Director)",
  "",
  "## Contact",
  "",
  "Phone: +49 341 1234567",
  "Email: [legal@kumiko.dev](mailto:legal@kumiko.dev)",
  "",
  "## VAT ID",
  "",
  "VAT identification number: DE123456789",
  "",
  "## Responsible for content",
  "",
  "Marc Frost, address as above",
].join("\n");

const PRIVACY_MARKDOWN = [
  "## 1. Controller",
  "",
  "Cosmic Drift Game Studio, Marc Frost, Slevogtstr. 10, 04159 Leipzig, Germany.",
  "Privacy contact: [privacy@kumiko.dev](mailto:privacy@kumiko.dev)",
  "",
  "## 2. Data we process",
  "",
  "- **Account:** email, password hash, tenant memberships",
  "- **Usage:** audit events, session IDs (revocable)",
  "- **Content:** entities you create in your tenant",
  "",
  "We use **no third-party tracking** and no marketing cookies.",
  "",
  "## 3. Legal bases (GDPR)",
  "",
  "| Purpose | Art. |",
  "|---|---|",
  "| Contract / account | Art. 6(1)(b) |",
  "| Legitimate interest (security, logs) | Art. 6(1)(f) |",
  "| Consent (optional newsletter) | Art. 6(1)(a) |",
  "",
  "## 4. Your rights",
  "",
  "Access, rectification, erasure, restriction, portability, objection — ",
  "via the built-in `user-data-rights` flows in the app or by email.",
].join("\n");

/** EN legal notice for docs screenshots (site is EN-only). */
export function getLegalImpressumHtml(): string {
  return wrapInLayout({
    title: "Legal notice",
    bodyHtml: renderMarkdownToHtml(IMPRINT_MARKDOWN),
    lang: "en",
    description: "Provider identification for public legal pages",
  });
}

/** Privacy policy page — paired with text-content + legal-pages docs. */
export function getLegalPrivacyHtml(): string {
  return wrapInLayout({
    title: "Privacy policy",
    bodyHtml: renderMarkdownToHtml(PRIVACY_MARKDOWN),
    lang: "en",
    description: "How we process personal data",
  });
}
