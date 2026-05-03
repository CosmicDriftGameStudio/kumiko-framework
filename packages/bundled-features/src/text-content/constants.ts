// Feature name
export const TEXT_CONTENT_FEATURE = "text-content" as const;

// Qualified write handler names (QN format: scope:type:name)
export const TextContentHandlers = {
  set: "text-content:write:set",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const TextContentQueries = {
  bySlug: "text-content:query:by-slug",
} as const;

// Error codes
export const TextContentErrors = {
  notFound: "text_block_not_found",
  invalidSlug: "invalid_slug",
  invalidLang: "invalid_lang",
} as const;
