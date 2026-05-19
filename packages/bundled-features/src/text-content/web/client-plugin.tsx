// @runtime client
// Client-Feature-Factory für text-content Visual-Tree. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [textContentClient()] }) eingehängt
// und liefert den treeProvider der Text-Blocks aus der by-tenant Query
// lädt, nach `folder`-Field gruppiert und als TreeNode[] emitted.
//
// **Folder-Gruppierung V.1.4**: Block.folder !== null → Knoten landet
// unter einem Container-Knoten mit Label folder. folder === null →
// Top-Level (root-node). Slug bleibt kebab-only validiert. Beispiele:
//   - folder="page", slug="hero"  → Folder "page", child "hero"
//   - folder=null,   slug="imprint" → root-node "imprint"
//
// **State**: TreeNode.state = "filled" wenn body gesetzt ist, sonst
// "stub" (hellgrau, Designer-Hinweis dass Slug existiert aber leer ist).
//
// **Fetch statt Subscribe**: V.1.4 ist Fetch-once beim Mount. Unsubscribe
// ist no-op. V.1.5+ kann SSE-driven Re-Emit einbauen wenn text-block-
// updated-Events propagiert werden (Stale-Tree-Fix nach save).

import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import type {
  TargetRef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import { useDispatcher, usePrimitives, useQuery } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { TextContentHandlers, TextContentQueries } from "../constants";

// Exported für Unit-Test (groupBlocksByFolder ist pure-function ohne
// fetch/DOM). Public-API für externe Konsumenten ist nicht intendiert —
// sub-path-Export endet bei textContentClient().
export type BlockSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly folder: string | null;
  readonly updatedAt: string;
};

type ByTenantResponse = {
  readonly data: { readonly blocks: readonly BlockSummary[] };
};

// V.1.4-Grouping: explicit folder-Field statt Slug-Prefix-Heuristik.
// block.folder === null → root-node; sonst Container-Knoten mit folder-
// Label. Folder-Knoten sind alphabetisch sortiert (deterministisch
// gegen Map-iteration-order, plus visuell-stable für User). Multi-level
// folders ("page/marketing") werden in V.1.4 noch flat gerendert —
// V.1.5 kann recursive Hierarchie einführen wenn gebraucht.
export function groupBlocksByFolder(blocks: readonly BlockSummary[]): readonly TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const folders = new Map<string, TreeNode[]>();

  for (const block of blocks) {
    const node: TreeNode = {
      label: block.title || block.slug,
      target: {
        featureId: "text-content",
        action: "edit",
        args: { slug: block.slug, lang: block.lang },
      },
      state: block.body ? "filled" : "stub",
    };

    if (block.folder === null) {
      rootNodes.push(node);
    } else {
      const existing = folders.get(block.folder) ?? [];
      existing.push(node);
      folders.set(block.folder, existing);
    }
  }

  for (const name of [...folders.keys()].sort()) {
    const children = folders.get(name);
    if (children === undefined) continue;
    rootNodes.push({
      label: name,
      icon: "folder",
      state: "filled",
      children,
    });
  }

  return rootNodes;
}

const treeProvider: TreeChildrenSubscribe = () => (emit, emitError) => {
  // CSRF-Header bei authenticated requests pflicht (auth-middleware
  // double-submit pattern). Anonymous/Pre-Login wäre csrf-token=undefined
  // → header weggelassen → server lässt die anonymous-Variante durch.
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = readCsrfToken();
  if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
  fetch("/api/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: TextContentQueries.byTenant,
      payload: {},
    }),
  })
    .then(async (r) => {
      if (!r.ok) {
        // 403 (CSRF/auth) oder 5xx — explicit error statt silent empty.
        const text = await r.text().catch(() => r.statusText);
        throw new Error(`text-content load failed: ${r.status} ${text}`);
      }
      return r.json();
    })
    .then((data: ByTenantResponse) => {
      const nodes = groupBlocksByFolder(data.data.blocks);
      emit(nodes);
    })
    .catch((e) => {
      // V.1.4: explicit error-Signal via emitError. ProviderBranch zeigt
      // Banner + Retry-Button. Fallback auf emit([]) wenn der Consumer
      // kein emitError unterstützt (Tests etc.).
      if (emitError) {
        emitError(e instanceof Error ? e : new Error(String(e)));
      } else {
        emit([]);
      }
    });
  return () => {};
};

// V.1.3 echte Edit-Form: lädt aktuelle Werte via by-slug-query, lässt
// TenantAdmin/SystemAdmin title + body editieren, dispatcht set-write
// bei Submit. Non-Admin-User sehen die Form read-only mit Hint-Banner —
// das ist der Kumiko-Weg (Memory `[Sicherheit > Convenience]`: write-
// permission bleibt opinionated TenantAdmin-only, App-Roles erweitern
// per Dual-Role-Mapping wenn gewollt).
//
// **Stale-Tree-Caveat (V.1.4-Followup)**: TreeProvider ist fetch-once.
// Nach erfolgreichem Save flippt der visual state="stub"→"filled" in
// der Sidebar NICHT, bis der User den Workspace re-mountet. Editor selbst
// ist konsistent (lokaler Form-State trägt die neuen Werte). Echte
// Lösung: SSE-driven Tree-Refresh oder explicit cache-bust nach set-write.

type TextBlock = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly folder: string | null;
  readonly updatedAt: string;
};

type SetResponse = { readonly slug: string; readonly lang: string; readonly isNew: boolean };

function TextContentEditor({
  target,
  onClose,
}: {
  readonly target: TargetRef;
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — TargetRef.args ist erased zu
  // Record<string, unknown>; der Resolver kennt das Action-Shape (siehe
  // treeActions.edit-Definition unten) und de-erased pro Action analog
  // zu Event-Payloads. Optional-Chain absorbiert fehlende Felder ohne
  // throw, damit der Editor auch bei manuellem URL-Tampering nicht
  // crasht (TargetRef könnte aus old localStorage / URL-State stammen).
  const args = target.args as { slug?: string; lang?: string } | undefined;
  const slug = args?.slug ?? "";
  const lang = args?.lang ?? "";

  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const dispatcher = useDispatcher();
  const user = useShellUser();
  const canWrite =
    user?.roles.includes("TenantAdmin") === true || user?.roles.includes("SystemAdmin") === true;

  // Load existing block via by-slug-query. Result ist entweder TextBlock
  // oder null (slug existiert nicht — create-flow). useQuery returnt
  // `data: T | null`, initial-loading: data=null + loading=true.
  const {
    data: loaded,
    loading,
    error: loadError,
  } = useQuery<TextBlock | null>(
    TextContentQueries.bySlug,
    { slug, lang },
    { enabled: slug !== "" && lang !== "" },
  );

  // Form-State unabhängig vom geladenen Block. Sync nur initial oder
  // wenn target.slug+lang wechselt (User springt zwischen Knoten).
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folder, setFolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Sync loaded data → form state. Trigger sobald loaded-shape eindeutig
  // ist (data ≠ undefined). loaded === null heißt "Block existiert noch
  // nicht" — leere Form für create-flow.
  useEffect(() => {
    if (loading) return;
    setTitle(loaded?.title ?? "");
    setBody(loaded?.body ?? "");
    setFolder(loaded?.folder ?? "");
    setSaveError(null);
    setSavedMsg(null);
  }, [loading, loaded]);

  const handleSave = async (): Promise<void> => {
    setSubmitting(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      const result = await dispatcher.write<SetResponse>(TextContentHandlers.set, {
        slug,
        lang,
        title,
        body: body.length > 0 ? body : null,
        folder: folder.length > 0 ? folder : null,
      });
      if (result.isSuccess) {
        setSavedMsg(result.data.isNew ? "Neu angelegt." : "Gespeichert.");
      } else {
        setSaveError(result.error.message ?? result.error.code ?? "Speichern fehlgeschlagen.");
      }
    } catch (e) {
      // Network-blip / dispatcher-throw — sonst bleibt submitting=true,
      // Save-Button locked-forever, User klickt repeat ohne Feedback.
      // Generic message reicht: konkreter Recovery-Pfad ist Retry.
      setSaveError(e instanceof Error ? e.message : "Netzwerkfehler beim Speichern.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void handleSave();
  };

  const disabled = submitting || loading || !canWrite;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">Text-Block bearbeiten</h2>
          <p className="text-xs text-muted-foreground">
            {slug || "—"} ({lang || "—"})
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          schlie&szlig;en
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <Form onSubmit={onSubmit}>
          {loading && <Banner variant="loading">Lädt aktuellen Stand…</Banner>}
          {loadError !== null && (
            <Banner variant="error">Konnte Block nicht laden: {loadError.code}</Banner>
          )}
          {!canWrite && !loading && (
            <Banner variant="info">
              Read-only — TenantAdmin- oder SystemAdmin-Rolle f&uuml;r &Auml;nderungen erforderlich.
            </Banner>
          )}
          <Field id="text-content-title" label="Titel" required>
            <Input
              kind="text"
              id="text-content-title"
              name="text-content-title"
              value={title}
              onChange={setTitle}
              disabled={disabled}
              required
            />
          </Field>
          <Field id="text-content-folder" label="Ordner (optional)">
            <Input
              kind="text"
              id="text-content-folder"
              name="text-content-folder"
              value={folder}
              onChange={setFolder}
              disabled={disabled}
              placeholder="z.B. page oder legal"
            />
          </Field>
          <Field id="text-content-body" label="Inhalt">
            <Input
              kind="textarea"
              id="text-content-body"
              name="text-content-body"
              value={body}
              onChange={setBody}
              disabled={disabled}
              rows={14}
            />
          </Field>
          {saveError !== null && <Banner variant="error">{saveError}</Banner>}
          {savedMsg !== null && <Banner variant="info">{savedMsg}</Banner>}
          {canWrite && (
            <Button type="submit" loading={submitting} disabled={disabled}>
              {submitting ? "Speichern…" : "Speichern"}
            </Button>
          )}
        </Form>
      </div>
    </div>
  );
}

export function textContentClient(): ClientFeatureDefinition {
  return {
    name: "text-content",
    treeProvider,
    treeActions: {
      edit: { args: { slug: "" as string, lang: "" as string } },
      list: {},
      create: { args: { folder: "" as string } },
    },
    resolvers: {
      "text-content:edit": TextContentEditor,
    },
  };
}
