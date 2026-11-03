import { describe, expect, test } from "bun:test";
import { linkedDocumentIds } from "../queries/list-page.ts";

type LinkPageQuery = { readonly cursor?: string };

function dispatchWithLinks(totalLinks: number, pageSize: number) {
  return {
    query: async (_name: string, payload: unknown) => {
      const { cursor } = payload as LinkPageQuery;
      const start = cursor === undefined ? 0 : Number(cursor);
      const end = Math.min(start + pageSize, totalLinks);
      const rows = [];
      for (let i = start; i < end; i++) rows.push({ documentId: `doc-${i}` });
      return { rows, nextCursor: end < totalLinks ? String(end) : null };
    },
  } as never;
}

describe("linkedDocumentIds", () => {
  const target = { entityType: "invoice", entityId: "inv-1" };

  test("collects the ids across all pages", async () => {
    const ids = await linkedDocumentIds({ dispatch: dispatchWithLinks(450, 200) }, target);
    expect(ids).toHaveLength(450);
  });

  test("rejects a record with more linked documents than the id filter can carry", async () => {
    await expect(
      linkedDocumentIds({ dispatch: dispatchWithLinks(10_300, 200) }, target),
    ).rejects.toThrow("more than 10000 linked documents");
  });
});
