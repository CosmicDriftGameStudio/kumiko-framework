// Pure schema.org JSON-LD builders — plain data, no HTML/escaping (the
// serialization boundary is `renderApexHeadTags`'s `scriptSafeJsonHtml`,
// which already escapes `<` so a value can't break out of the
// `<script type="application/ld+json">` block). Feed the result into
// `ApexHead.schemaJson` (renderApexPage) or `wrapInLayout({ seo: { schemaJson
// } })` (CMS pages) — this feature does not inject JSON-LD on its own routes.

export type OrganizationSchemaInput = {
  readonly name: string;
  readonly url?: string;
  readonly logoUrl?: string;
  readonly sameAs?: readonly string[];
};

export function organizationSchema(input: OrganizationSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.logoUrl ? { logo: input.logoUrl } : {}),
    ...(input.sameAs && input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
  };
}

export type WebPageSchemaInput = {
  readonly name: string;
  readonly url: string;
  readonly description?: string;
};

export function webPageSchema(input: WebPageSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
  };
}

export type FaqItem = { readonly question: string; readonly answer: string };

// Feeds Google's FAQ rich-result + is the most directly LLM-answer-engine-
// legible JSON-LD shape (question/answer pairs) — the "AEO/GEO" half of the
// schema-builder set, same emission path as organizationSchema/webPageSchema.
export function faqPageSchema(items: readonly FaqItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
