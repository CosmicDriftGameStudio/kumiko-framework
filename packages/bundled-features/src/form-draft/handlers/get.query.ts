import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_ACCESS } from "../constants";
import { lookupDraft } from "../lookup";
import type { FormDraftBlob } from "../schemas";
import { getDraftPayloadSchema } from "../schemas";

export type GetDraftResult = { readonly draft: FormDraftBlob | null };

// get — resolves to `{ draft: null }` for both "no draft saved yet" and "a
// draft exists but belongs to someone else / another tenant" — the lookup
// is scoped by (tenantId, ownerId, draftKey), so a foreign caller's query
// never surfaces another user's row, it just looks like no draft exists.
export const getDraftQuery = defineQueryHandler({
  name: "get",
  schema: getDraftPayloadSchema,
  access: FORM_DRAFT_ACCESS,
  handler: async (query, ctx): Promise<GetDraftResult> => {
    const row = await lookupDraft(
      ctx.db,
      query.user.tenantId,
      query.user.id,
      query.payload.draftKey,
    );
    return { draft: row?.draft ?? null };
  },
});
