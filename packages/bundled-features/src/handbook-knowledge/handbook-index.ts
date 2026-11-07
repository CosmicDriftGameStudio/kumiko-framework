import * as z from "zod";

const handbookPageSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["process", "screen"]),
  title: z.string(),
  questions: z.array(z.string()),
  screens: z.array(z.string()),
  start: z.string().min(1).optional(),
  bodyMd: z.string(),
});

const handbookKnowledgeSchema = z
  .object({
    defaultLocale: z.string().min(1),
    locales: z.record(z.string(), z.array(handbookPageSchema)),
  })
  .refine((knowledge) => knowledge.defaultLocale in knowledge.locales, {
    message: "defaultLocale must be a key of locales",
    path: ["defaultLocale"],
  });

export type HandbookPage = z.infer<typeof handbookPageSchema>;

export type HandbookIndex = {
  listPages(requestedLocale: string): { locale: string; pages: readonly HandbookPage[] };
  findPage(requestedLocale: string, id: string): { locale: string; page: HandbookPage } | undefined;
};

// Validates the JSON that `kumiko handbuch knowledge` writes, once at boot.
export function createHandbookIndex(rawKnowledge: unknown): HandbookIndex {
  const knowledge = handbookKnowledgeSchema.parse(rawKnowledge);
  const pagesByLocale = new Map(
    Object.entries(knowledge.locales).map(([locale, pages]) => [
      locale,
      new Map(pages.map((page) => [page.id, page])),
    ]),
  );
  const defaultPages =
    pagesByLocale.get(knowledge.defaultLocale) ?? new Map<string, HandbookPage>();

  // "de-AT" serves "de"; anything the handbook has no text for serves the default language.
  const resolveLocale = (requestedLocale: string): string => {
    const baseLanguage = requestedLocale.split("-")[0] ?? requestedLocale;
    return (
      [requestedLocale, baseLanguage].find((candidate) => pagesByLocale.has(candidate)) ??
      knowledge.defaultLocale
    );
  };

  return {
    listPages(requestedLocale) {
      const locale = resolveLocale(requestedLocale);
      const merged = new Map(defaultPages);
      for (const [id, page] of pagesByLocale.get(locale) ?? []) merged.set(id, page);
      return { locale, pages: [...merged.values()] };
    },
    findPage(requestedLocale, id) {
      const locale = resolveLocale(requestedLocale);
      const page = pagesByLocale.get(locale)?.get(id);
      if (page) return { locale, page };
      const fallback = defaultPages.get(id);
      return fallback ? { locale: knowledge.defaultLocale, page: fallback } : undefined;
    },
  };
}
