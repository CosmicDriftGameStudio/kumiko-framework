export const HANDBOOK_KNOWLEDGE_FEATURE = "handbook-knowledge";

export const HandbookKnowledgeQueries = {
  listPages: `${HANDBOOK_KNOWLEDGE_FEATURE}:query:list-pages`,
  readPage: `${HANDBOOK_KNOWLEDGE_FEATURE}:query:read-page`,
} as const;

export const HANDBOOK_PAGE_MAX_CHARS = 12_000;
