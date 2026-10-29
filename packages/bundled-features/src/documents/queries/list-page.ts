import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { DocumentsQueries } from "../constants.ts";

const LINK_LIST = "documents:query:document-link:list";
const LINK_PAGE_SIZE = 200;

const pageSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable().optional(),
  total: z.number().optional(),
});
export type ListPage = z.infer<typeof pageSchema>;

export type ListFilter = { readonly field: string; readonly op: string; readonly value: unknown };

export async function listDocuments(
  ctx: Pick<HandlerContext, "dispatch">,
  payload: Record<string, unknown>,
): Promise<ListPage> {
  return pageSchema.parse(await ctx.dispatch.query(DocumentsQueries.list, payload));
}

// Goes through the link list, so a record the caller cannot read yields no ids (the link's
// parentRef gate), and a document is then fetched through the document list, which applies the
// document's own read gate again.
export async function linkedDocumentIds(
  ctx: Pick<HandlerContext, "dispatch">,
  target: { readonly entityType: string; readonly entityId: string },
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = pageSchema.parse(
      await ctx.dispatch.query(LINK_LIST, {
        filters: [
          { field: "entityType", op: "eq", value: target.entityType },
          { field: "entityId", op: "eq", value: target.entityId },
        ],
        limit: LINK_PAGE_SIZE,
        ...(cursor !== undefined && { cursor }),
      }),
    );
    for (const row of page.rows) {
      const documentId = row["documentId"];
      if (typeof documentId === "string") ids.push(documentId);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ids;
}
