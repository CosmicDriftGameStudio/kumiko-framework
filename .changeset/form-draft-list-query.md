---
"@cosmicdrift/kumiko-bundled-features": minor
---

`form-draft` gets a new query handler, `form-draft:query:list`, returning a user's open drafts for a given `screenId` (id, draftKey, stepIndex, savedAt — never the blob's `values`). Fallback path for wizard-mode resume when a client-generated `draftId` is lost (new tab, cleared storage, another device).
