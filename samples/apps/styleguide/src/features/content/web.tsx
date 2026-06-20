// @runtime client
// Client-Seite des Content-Stresstests: der navProvider hängt sich an den
// statischen `content`-Nav-Knoten (QN "content:nav:content"), lädt die Seiten
// per /api/query und emittiert sie als Tree-Leaves. navEntities ["page"]
// abonniert die Live-Events → nach einem Create erscheint die neue Seite
// sofort im Sidebar-Tree. Der content:edit-Resolver rendert das Anlege-
// Formular (leeres target) bzw. die Detail-Ansicht (target mit id).

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import type {
  TargetRef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import { useDispatcher, usePrimitives, useQuery } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

type Page = { readonly id: string; readonly slug: string; readonly title: string };
type ListResponse = { readonly data: { readonly rows: readonly Page[] } };
type CreateResponse = { readonly id: string };

const navProvider: TreeChildrenSubscribe = () => (emit, emitError) => {
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

function PageEditor({
  target,
  onClose,
}: {
  readonly target: TargetRef;
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — TargetRef.args ist erased; der Resolver
  // kennt das edit-Action-Shape (siehe createAction in feature.ts).
  const args = target.args as { id?: string } | undefined;
  const id = args?.id ?? "";
  const isCreate = id === "";

  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const dispatcher = useDispatcher();

  const { data: loaded } = useQuery<Page | null>(
    "content:query:page:detail",
    { id },
    { enabled: !isCreate },
  );

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlug(loaded?.slug ?? "");
    setTitle(loaded?.title ?? "");
  }, [loaded]);

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void (async () => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await dispatcher.write<CreateResponse>("content:write:page:create", {
          slug,
          title,
        });
        if (res.isSuccess) {
          // Schließen → SSE (treeEntities ["page"]) refresht den Nav-Tree,
          // die neue Seite erscheint links.
          onClose();
          return;
        }
        setError(res.error.message ?? res.error.code ?? "Anlegen fehlgeschlagen.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Netzwerkfehler.");
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold">{isCreate ? "Neue Seite" : "Seite"}</h2>
        <p className="text-muted-foreground text-xs">
          {isCreate ? "Add a new page to Content" : id}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <Form onSubmit={onSubmit}>
          <Field id="content-slug" label="Slug" required>
            <Input
              kind="text"
              id="content-slug"
              name="content-slug"
              value={slug}
              onChange={setSlug}
              disabled={submitting || !isCreate}
              required
            />
          </Field>
          <Field id="content-title" label="Title" required>
            <Input
              kind="text"
              id="content-title"
              name="content-title"
              value={title}
              onChange={setTitle}
              disabled={submitting || !isCreate}
              required
            />
          </Field>
          {error !== null && <Banner variant="error">{error}</Banner>}
          {isCreate && (
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? "Speichern…" : "Seite anlegen"}
            </Button>
          )}
        </Form>
      </div>
    </div>
  );
}

export function contentClient(): ClientFeatureDefinition {
  return {
    name: "content",
    navProviders: { content: navProvider },
    navEntities: { content: ["page"] },
    resolvers: { "content:edit": PageEditor },
  };
}
