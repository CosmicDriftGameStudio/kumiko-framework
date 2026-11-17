// Client side of the content stress test: the navProvider attaches to the
// static `content` nav node (QN "content:nav:content"), loads the pages
// via /api/query and emits them as tree leaves. navEntities ["page"]
// subscribes to the live events → after a create the new page appears
// immediately in the sidebar tree. The content:edit resolver renders the create
// form (empty target) or the detail view (target with id).

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-renderer/live";

export type Page = { readonly id: string; readonly slug: string; readonly title: string };
type ListResponse = { readonly data: { readonly rows: readonly Page[] } };

export const navProvider: TreeChildrenSubscribe = () => (emit, emitError) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = readCsrfToken();
  if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
  fetch("/api/query", {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "content:query:page:list", payload: {} }),
  })
    .then(async (r) => {
      if (!r.ok)
        throw new Error(`pages load failed: ${r.status} ${await r.text().catch(() => "")}`);
      return r.json() as Promise<ListResponse>;
    })
    .then((data) => {
      const leaves: TreeNode[] = data.data.rows.map((row) => ({
        label: row.title || row.slug,
        icon: "file",
        target: { featureId: "content", action: "edit", args: { id: row.id } },
      }));
      emit(leaves);
    })
    .catch((e) => {
      if (emitError) emitError(e instanceof Error ? e : new Error(String(e)));
      else emit([]);
    });
  return () => {};
};
