import { z } from "zod";

// entityType/entityId are app-supplied — mirror tags' NO_PIPE guard isn't
// needed here since note-entry has no deterministic aggregate-id derived
// from these fields (see aggregate-id note in entity.ts): a literal value
// can't shift stream-id tuple boundaries when there is no such tuple.
// `mentions` carries structured @-mentions from the editor as user ids —
// never parsed out of `body` text (regex/NLP over free text is unreliable,
// see entity.ts). Capped well above any realistic note; a client sending more
// is a bug, not a use case worth accommodating.
export const addNotePayloadSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
  body: z.string().trim().min(1).max(20_000),
  mentions: z.array(z.uuid()).max(50).optional(),
});
export type AddNotePayload = z.infer<typeof addNotePayloadSchema>;
