import { describe, expect, test } from "bun:test";
import { faqPageSchema, organizationSchema, webPageSchema } from "../schema-builders";

describe("organizationSchema", () => {
  test("minimal input", () => {
    expect(organizationSchema({ name: "Acme" })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme",
    });
  });

  test("full input", () => {
    expect(
      organizationSchema({
        name: "Acme",
        url: "https://acme.test",
        logoUrl: "https://acme.test/logo.png",
        sameAs: ["https://x.com/acme"],
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme",
      url: "https://acme.test",
      logo: "https://acme.test/logo.png",
      sameAs: ["https://x.com/acme"],
    });
  });
});

describe("webPageSchema", () => {
  test("emits WebPage type", () => {
    expect(webPageSchema({ name: "About", url: "https://acme.test/about" })).toMatchObject({
      "@type": "WebPage",
      name: "About",
      url: "https://acme.test/about",
    });
  });
});

describe("faqPageSchema", () => {
  test("maps question/answer pairs to mainEntity", () => {
    const schema = faqPageSchema([{ question: "Q1?", answer: "A1." }]);
    expect(schema).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Q1?",
          acceptedAnswer: { "@type": "Answer", text: "A1." },
        },
      ],
    });
  });
});
