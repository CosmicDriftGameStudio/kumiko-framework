import {
  createEntity,
  createJsonbField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_KEY_MAX_LENGTH, FORM_DRAFT_UNIQUE_KEY_CONSTRAINT } from "./constants";

// form-draft — a per-user, pre-submission working copy of an in-progress
// form (e.g. a wizard-mode EditLayout). `draftKey` is caller-assigned
// (typically screenId + optional hostEntityId) and scoped to
// (tenant, ownerId): the same key from two different users, or the same
// user in two different tenants, is a different draft.
//
// Boundary (issue #1889): form-draft never holds anything that already
// lives in a domain stream — it's a Zwischenstand BEFORE the domain entity
// is created. Consumers delete the draft (discard handler) once the real
// submit succeeds; partially-created domain data past that point is the
// consuming app's concern, not this feature's.
export const formDraftEntity = createEntity({
  table: "read_form_drafts",
  fields: {
    // Never client-supplied — stamped from event.user.id (see handlers), so
    // a draft can't be saved/read/discarded as someone else. subjectRef
    // feeds the GDPR-hook-coverage boot guard (it's a plain FK into `user`,
    // not content of its own) — see ../form-draft-user-data for the
    // required export/delete hook coverage.
    ownerId: createTextField({ subjectRef: true }),
    draftKey: createTextField({ required: true, maxLength: FORM_DRAFT_KEY_MAX_LENGTH }),
    // The blob shape is fixed by issue #1889, not left to the caller:
    // { values: Record<string, unknown>, stepIndex: number, savedAt: string }.
    // Free-form because `values` mirrors whatever fields the in-progress
    // form has — userOwned because it can carry arbitrary user-entered PII;
    // erasure runs via crypto-shredding (see form-draft-user-data/hooks.ts),
    // same tradeoff as notes-history's `body`.
    draft: createJsonbField({ userOwned: { ownerField: "ownerId" } }),
  },
  // One draft per (tenant, owner, draftKey) — save() is an upsert keyed on
  // this index (see handlers/save.write.ts); a resume query must find at
  // most one row.
  indexes: [
    {
      columns: ["tenantId", "ownerId", "draftKey"],
      unique: true,
      name: FORM_DRAFT_UNIQUE_KEY_CONSTRAINT,
    },
  ],
});
