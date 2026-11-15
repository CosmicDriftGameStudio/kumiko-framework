// Pure string constants, safe for browser code.
export const DOCUMENT_DRAFT_FEATURE = "document-draft" as const;

export const DOCUMENT_DRAFT_ENTITY = "documentDraft" as const;

export const DOCUMENT_DRAFT_STATUS = {
  Open: "open",
  Finalized: "finalized",
  Discarded: "discarded",
} as const;

export type DocumentDraftStatus =
  (typeof DOCUMENT_DRAFT_STATUS)[keyof typeof DOCUMENT_DRAFT_STATUS];

export const DOCUMENT_DRAFT_STATUS_TONE = {
  [DOCUMENT_DRAFT_STATUS.Open]: "warn",
  [DOCUMENT_DRAFT_STATUS.Finalized]: "ok",
  [DOCUMENT_DRAFT_STATUS.Discarded]: "neutral",
} as const;

export const DOCUMENT_DRAFT_LAST_CHANGE_SOURCE = {
  Create: "create",
  Ops: "ops",
  Editor: "editor",
} as const;

export const DocumentDraftHandlers = {
  create: `${DOCUMENT_DRAFT_FEATURE}:write:create`,
  patch: `${DOCUMENT_DRAFT_FEATURE}:write:patch`,
  save: `${DOCUMENT_DRAFT_FEATURE}:write:save`,
  finalize: `${DOCUMENT_DRAFT_FEATURE}:write:finalize`,
  revise: `${DOCUMENT_DRAFT_FEATURE}:write:revise`,
  discard: `${DOCUMENT_DRAFT_FEATURE}:write:discard`,
} as const;

export const DocumentDraftQueries = {
  blocks: `${DOCUMENT_DRAFT_FEATURE}:query:blocks`,
  bySubject: `${DOCUMENT_DRAFT_FEATURE}:query:by-subject`,
} as const;

export const DOCUMENT_DRAFT_ERROR = {
  NotOpen: "document_draft_not_open",
  NotFinalized: "document_draft_not_finalized",
  TemplateNotFound: "template_not_found",
  OpNotAllowed: "op_not_allowed",
} as const;

export const DOCUMENT_DRAFT_DEFAULT_LOCALE = "de";
export const DOCUMENT_DRAFT_MAX_CONTENT_LENGTH = 200_000;

// Short screen id as in the URL and in `r.screen`; the qualified name is `document-draft:screen:<id>`.
export const DOCUMENT_DRAFT_EDITOR_SCREEN_ID = "document-draft-editor" as const;

/** Qualified name for targets in other features, e.g. an app actionForm `redirect`. */
export const DOCUMENT_DRAFT_EDITOR_SCREEN_QN =
  `${DOCUMENT_DRAFT_FEATURE}:screen:${DOCUMENT_DRAFT_EDITOR_SCREEN_ID}` as const;
