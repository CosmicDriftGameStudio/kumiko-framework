import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { lookupDraft } from "../lookup.ts";
import type { FormDraftBlob } from "../schemas.ts";
import { getDraftPayloadSchema } from "../schemas.ts";
import { FORM_DRAFT_ACCESS } from "../web/constants.ts";

export type GetDraftResult = { readonly draft: FormDraftBlob | null };

// get — resolves to `{ draft: null }` for both "no draft saved yet" and "a
// draft exists but belongs to someone else / another tenant" — the lookup
// is scoped by (tenantId, ownerId, draftKey), so a foreign caller's query
// never surfaces another user's row, it just looks like no draft exists.
export const getDraftQuery = defineQueryHandler({
  name: "get",
  schema: getDraftPayloadSchema,
  access: FORM_DRAFT_ACCESS,
  description:
    "Returns the calling user's saved draft blob (form values and step index) for one draftKey, or null when they have no such draft; use it to resume an in-progress form.",
  handler: async (query, ctx): Promise<GetDraftResult> => {
    const row = await lookupDraft(
      ctx.db,
      query.user.tenantId,
      query.user.id,
      query.payload.draftKey,
    );
    if (!row) return { draft: null };
    if (!row.draft) {
      // Schema evolution or a corrupt/erased row: surface it to operators
      // instead of silently making the user's draft vanish.
      ctx.log?.warn?.(
        `[form-draft:get] stored blob for draftKey=${query.payload.draftKey} failed schema or decryption, treating as absent`,
      );
      return { draft: null };
    }
    return { draft: row.draft };
  },
});
