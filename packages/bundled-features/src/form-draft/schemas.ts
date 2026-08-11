import { z } from "zod";
import { FORM_DRAFT_KEY_MAX_LENGTH } from "./constants";

const draftKeySchema = z.string().trim().min(1).max(FORM_DRAFT_KEY_MAX_LENGTH);

// The draft blob shape — fixed by issue #1889 here, not left for consumers
// to invent per-app. `stepIndex` is in from the start so wizard-mode resume
// (kumiko-framework#1884) doesn't need a later migration.
export const formDraftBlobSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  stepIndex: z.number().int().min(0),
  savedAt: z.string(),
});
export type FormDraftBlob = z.infer<typeof formDraftBlobSchema>;

// savedAt is stamped server-side (see handlers/save.write.ts) — never
// accepted from the caller.
export const saveDraftPayloadSchema = z.object({
  draftKey: draftKeySchema,
  values: z.record(z.string(), z.unknown()),
  stepIndex: z.number().int().min(0),
});
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;

// releaseFiles defaults to false/absent: the caller's only two current call
// sites (render-edit.tsx, both on a *successful submit*) delete the draft
// row right after the domain entity write already carries the same
// storageKeys forward — releasing them here would destroy files the entity
// now depends on. Only an actual abandon/abort flow should pass
// releaseFiles: true (issue #1915's "explicit abort" case).
export const discardDraftPayloadSchema = z.object({
  draftKey: draftKeySchema,
  releaseFiles: z.boolean().optional(),
});
export type DiscardDraftPayload = z.infer<typeof discardDraftPayloadSchema>;

export const getDraftPayloadSchema = z.object({
  draftKey: draftKeySchema,
});
export type GetDraftPayload = z.infer<typeof getDraftPayloadSchema>;

// screenId is the draftKey's leading segment by convention (see lookup.ts),
// so it shares the same charset/length constraints as a full draftKey.
export const listDraftsPayloadSchema = z.object({
  screenId: draftKeySchema,
});
export type ListDraftsPayload = z.infer<typeof listDraftsPayloadSchema>;
