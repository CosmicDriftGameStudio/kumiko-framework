// Fixed per section, not derived from the translated heading, so de and en link alike.
export const overviewSectionIds = {
  endpoints: "endpoints",
  auth: "authentication",
  body: "request-body",
  responses: "responses",
  errors: "error-codes",
  versions: "versions",
  lists: "lists",
  batch: "batches",
  retry: "retries",
} as const;

export const eventsSectionIds = {
  delivery: "delivery",
  versions: "versions",
  list: "events",
} as const;

export const tokensSectionIds = {
  create: "create-token",
  use: "use-token",
  scopes: "scopes",
  rateLimit: "rate-limit",
  errors: "errors",
  revoke: "revoke-token",
  security: "security",
} as const;
