// @runtime client
// Client feature factory for the text-block content tree. Apps mount it via
// createKumikoApp({ clientFeatures: [textBlocksClient()] }); it loads the
// blocks from the by-tenant query, groups them by their `folder` field and
// emits them as TreeNode[], plus the editor behind the edit action.
//
// **Folder grouping**: block.folder !== null puts the node under a container
// node labelled with the folder; folder === null keeps it at the root.
//
// **State**: TreeNode.state = "filled" when content is set, otherwise "stub"
// (a hint that the slug exists but is empty).

import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import type {
  TargetRef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  type FeatureSchema,
  useAppFeatures,
  useContentEditor,
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ClientFeatureDefinition, PlainContentEditor } from "@cosmicdrift/kumiko-renderer-web";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  collectionHandlerName,
  collectionQueryName,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../qualified-names";
import { defaultTranslations } from "./i18n";

// Exported for the unit test — groupBlocksByFolder is a pure function.
export type BlockSummary = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly folder: string | null;
  readonly updatedAt: string;
};

type ByTenantResponse = {
  readonly data: { readonly blocks: readonly BlockSummary[] };
};

// Multi-level folder splitting: `folder` is a `/`-separated path, the tree
// splits per segment and creates nested folder nodes:
//   block.folder = null              → root leaf
//   block.folder = "page"            → folder page > leaf
//   block.folder = "page/marketing"  → folder page > folder marketing > leaf
//
// **Folder/leaf collision**: a block with `folder=null, slug="page"` and
// another with `folder="page"` both live on the same level — the folder with
// children plus a clickable leaf. Visually distinct (chevron + folder icon),
// no crash, no surprise.

type FolderNode = {
  readonly leaves: TreeNode[];
  readonly subFolders: Map<string, FolderNode>;
};

function newFolderNode(): FolderNode {
  return { leaves: [], subFolders: new Map() };
}

function attachBlock(
  root: FolderNode,
  block: BlockSummary,
  tenantIdOverride?: string,
  collectionId?: string,
): void {
  const leaf: TreeNode = {
    label: block.title || block.slug,
    icon: "file",
    target: {
      featureId: "template-resolver",
      action: "edit",
      // tenantIdOverride and collectionId travel with the node → the editor
      // reads and writes through the same tenant and the same collection the
      // tree was loaded from. Omitted → session tenant, public text-blocks.
      args: {
        slug: block.slug,
        locale: block.locale,
        ...(tenantIdOverride !== undefined && { tenantIdOverride }),
        ...(collectionId !== undefined && { collectionId }),
      },
    },
    state: block.content ? "filled" : "stub",
  };
  if (block.folder === null) {
    root.leaves.push(leaf);
    return;
  }
  let cur = root;
  for (const segment of block.folder.split("/")) {
    let next = cur.subFolders.get(segment);
    if (next === undefined) {
      next = newFolderNode();
      cur.subFolders.set(segment, next);
    }
    cur = next;
  }
  cur.leaves.push(leaf);
}

function renderFolderNode(node: FolderNode): TreeNode[] {
  // Leaves first (root items), then folders alphabetically.
  const result: TreeNode[] = [...node.leaves];
  for (const folderName of [...node.subFolders.keys()].sort()) {
    const subNode = node.subFolders.get(folderName);
    if (subNode === undefined) continue;
    result.push({
      label: folderName,
      icon: "folder",
      state: "filled",
      children: renderFolderNode(subNode),
    });
  }
  return result;
}

export function groupBlocksByFolder(
  blocks: readonly BlockSummary[],
  tenantIdOverride?: string,
  collectionId?: string,
): readonly TreeNode[] {
  const root = newFolderNode();
  for (const block of blocks) {
    attachBlock(root, block, tenantIdOverride, collectionId);
  }
  const rendered = renderFolderNode(root);
  if (rendered.length === 0) return [];
  return [
    {
      label: "Content",
      icon: "folder",
      state: "filled",
      children: rendered,
    },
  ];
}

// tenantIdOverride (SystemAdmin-only) lets an app point the content tree at a
// tenant other than the session's — publicstatus seeds marketing/legal blocks
// on SYSTEM_TENANT_ID, so its SystemAdmin must read that tenant, not their own.
// Without a collection id: the anonymous-capable by-tenant query, so a public
// page keeps its content sidebar without a session. With one: that
// collection's own list handler, which carries the collection's access rule.
function makeTreeProvider(tenantIdOverride?: string, collectionId?: string): TreeChildrenSubscribe {
  const queryType =
    collectionId === undefined
      ? TemplateResolverQueries.byTenant
      : collectionQueryName(collectionId, "list");
  return () => (emit, emitError) => {
    // CSRF header is mandatory on authenticated requests (auth-middleware
    // double-submit pattern). Anonymous/pre-login has no token → header
    // omitted → the server takes the anonymous path.
    const headers: Record<string, string> = { "content-type": "application/json" };
    const csrf = readCsrfToken();
    if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
    fetch("/api/query", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: queryType,
        payload: tenantIdOverride !== undefined ? { tenantIdOverride } : {},
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          // 403 (CSRF/auth) or 5xx — explicit error instead of silent empty.
          const text = await r.text().catch(() => r.statusText);
          throw new Error(`text-block load failed: ${r.status} ${text}`);
        }
        return r.json();
      })
      .then((data: ByTenantResponse) => {
        // The app-side r.nav node IS the "Content" container → the provider's
        // children are the folders/leaves below it, not the wrapper.
        const content = groupBlocksByFolder(data.data.blocks, tenantIdOverride, collectionId)[0];
        emit(content !== undefined && Array.isArray(content.children) ? content.children : []);
      })
      .catch((e) => {
        // Explicit error signal via emitError; ProviderBranch shows a banner
        // plus retry. Falls back to emit([]) for consumers without emitError.
        if (emitError) {
          emitError(e instanceof Error ? e : new Error(String(e)));
        } else {
          emit([]);
        }
      });
    return () => {};
  };
}

// contentFormat lives on the collection the node came from, not on the
// entity — a node without a collectionId (the hand-wired text-block tree)
// has none, useContentEditor then falls back to "plain" on its own.
function findContentFormat(
  features: readonly FeatureSchema[],
  collectionId?: string,
): string | undefined {
  if (collectionId === undefined) return undefined;
  for (const feature of features) {
    const match = feature.contentCollections?.find((c) => c.id === collectionId);
    if (match !== undefined) return match.contentFormat;
  }
  return undefined;
}

// Same lookup as findContentFormat, for the collection's fixed variable
// names (ContentCollectionDefinition.variableSchema) — the chip bar's data
// source. A node without a collectionId gets no chips: the hand-wired
// text-block tree has no collection to declare variables on.
function findVariableSchema(
  features: readonly FeatureSchema[],
  collectionId?: string,
): readonly string[] {
  if (collectionId === undefined) return [];
  for (const feature of features) {
    const match = feature.contentCollections?.find((c) => c.id === collectionId);
    if (match !== undefined) return Object.keys(match.variableSchema ?? {});
  }
  return [];
}

// Edit form: loads the current values via by-slug, lets TenantAdmin and
// SystemAdmin edit title + content, dispatches set on submit. Other users see
// the form read-only with a hint banner — write permission stays opinionated
// TenantAdmin-only, apps widen it via dual-role mapping if they want to.

type TextBlock = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly folder: string | null;
  readonly updatedAt: string;
};

type SetResponse = { readonly slug: string; readonly locale: string; readonly isNew: boolean };

function TextBlockEditor({
  target,
}: {
  readonly target: TargetRef;
  // onClose stays part of the resolver contract (the visual panel passes it)
  // but is unused: tree selection navigates, there is no close button.
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — TargetRef.args is erased to
  // Record<string, unknown>; the resolver knows the action shape (see the
  // treeActions.edit definition in feature.ts) and de-erases per action, the
  // same way event payloads do. Optional chaining absorbs missing fields so a
  // hand-edited URL cannot crash the editor.
  const args = target.args as
    | { slug?: string; locale?: string; collectionId?: string; tenantIdOverride?: string }
    | undefined;
  const slug = args?.slug ?? "";
  const locale = args?.locale ?? "";
  const tenantIdOverride = args?.tenantIdOverride;
  // Which collection the node came from. Absent → the public text-block pair,
  // which is what the hand-wired content tree uses.
  const collectionId = args?.collectionId;

  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const dispatcher = useDispatcher();
  const user = useShellUser();
  const t = useTranslation();
  const features = useAppFeatures();
  const contentFormat = findContentFormat(features, collectionId);
  const variables = findVariableSchema(features, collectionId);
  const ContentEditor = useContentEditor(contentFormat);
  const canWrite =
    user?.roles.includes("TenantAdmin") === true || user?.roles.includes("SystemAdmin") === true;

  // Same split as the tree provider: a node without a collection reads through
  // the public by-slug, a collection node through that collection's handlers.
  const readQuery =
    collectionId === undefined
      ? TemplateResolverQueries.bySlug
      : collectionQueryName(collectionId, "item");
  const writeHandler =
    collectionId === undefined ? TemplateResolverHandlers.set : collectionHandlerName(collectionId);
  const {
    data: loaded,
    loading,
    error: loadError,
  } = useQuery<TextBlock | null>(
    readQuery,
    { slug, locale, ...(tenantIdOverride !== undefined && { tenantIdOverride }) },
    { enabled: slug !== "" && locale !== "" },
  );

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Sync loaded data into the form state. loaded === null means the block does
  // not exist yet — empty form for the create flow.
  useEffect(() => {
    if (loading) return;
    setTitle(loaded?.title ?? "");
    setContent(loaded?.content ?? "");
    setSaveError(null);
    setSavedMsg(null);
  }, [loading, loaded]);

  const handleSave = async (): Promise<void> => {
    setSubmitting(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      const result = await dispatcher.write<SetResponse>(writeHandler, {
        slug,
        locale,
        title,
        content: content.length > 0 ? content : null,
        folder: loaded?.folder ?? null,
        ...(tenantIdOverride !== undefined && { tenantIdOverride }),
      });
      if (result.isSuccess) {
        setSavedMsg(
          result.data.isNew
            ? t("template-resolver.editor.created")
            : t("template-resolver.editor.saved"),
        );
        return;
      }
      setSaveError(
        result.error.message ?? result.error.code ?? t("template-resolver.editor.saveFailed"),
      );
    } catch (e) {
      // Network blip / dispatcher throw — otherwise submitting stays true and
      // the save button is locked forever with no feedback.
      setSaveError(e instanceof Error ? e.message : t("template-resolver.editor.networkError"));
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
    <Form
      onSubmit={onSubmit}
      testId="text-block-editor"
      title={title || slug || "—"}
      subtitle={locale !== "" ? `${slug} · (${locale})` : slug}
      actions={
        canWrite ? (
          <Button type="submit" loading={submitting} disabled={disabled}>
            {submitting ? t("template-resolver.editor.saving") : t("template-resolver.editor.save")}
          </Button>
        ) : undefined
      }
    >
      {loading && <Banner variant="loading">{t("template-resolver.editor.loading")}</Banner>}
      {loadError !== null && (
        <Banner variant="error">
          {t("template-resolver.editor.loadFailed")}: {loadError.code}
        </Banner>
      )}
      {!canWrite && !loading && (
        <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>
      )}
      <Field id="text-block-title" label={t("template-resolver.editor.titleLabel")} required>
        <Input
          kind="text"
          id="text-block-title"
          name="text-block-title"
          value={title}
          onChange={setTitle}
          disabled={disabled}
          required
        />
      </Field>
      <Field id={CONTENT_EDITOR_ELEMENT_ID} label={t("template-resolver.editor.contentLabel")}>
        <ContentEditor
          value={content}
          onChange={setContent}
          variables={variables}
          readOnly={disabled}
        />
      </Field>
      {saveError !== null && <Banner variant="error">{saveError}</Banner>}
      {savedMsg !== null && <Banner variant="info">{savedMsg}</Banner>}
    </Form>
  );
}

// `navId` = the QN of the r.nav({ provider: true }) node the app registers for
// the content tree (e.g. "publicstatus:nav:content"). The app owns the node's
// label/icon/access, the feature only supplies children plus the editor.
// Without navId: resolver only, no sidebar node (server-only consumers such as
// money-horse leak nothing).
// `tenantId` (SystemAdmin-only): which tenant the tree and editor serve —
// SYSTEM_TENANT_ID for apps that seed marketing/legal there. Omit for the
// session tenant (default, no cross-tenant access).
//
// Beyond that single tree, this client also serves every content collection
// the app declares via r.contentCollection() — one provider per collection,
// filtered to its kind. Those need no navId here; their nav QN comes from the
// schema, so navId and kind can't drift apart.
export function textBlocksClient(opts?: {
  readonly navId?: string;
  readonly tenantId?: string;
}): ClientFeatureDefinition {
  const navId = opts?.navId;
  const tenantId = opts?.tenantId;
  return {
    name: "template-resolver",
    ...(navId !== undefined && {
      navProviders: { [navId]: makeTreeProvider(tenantId) },
      // SSE refresh: every template-resource event re-fires the provider.
      navEntities: { [navId]: ["template-resource"] },
    }),
    // Every r.contentCollection() in the app gets its own tree, filtered to
    // that collection's kind. The explicit navId above stays independent of
    // this — an app can have both a hand-wired content tree and collections.
    navProvidersFromCollections: (collections) => ({
      providers: Object.fromEntries(
        collections.map((c) => [c.navQn, makeTreeProvider(tenantId, c.id)]),
      ),
      entities: Object.fromEntries(collections.map((c) => [c.navQn, ["template-resource"]])),
    }),
    resolvers: {
      "template-resolver:edit": TextBlockEditor,
    },
    // The default for every "plain" collection (ai-prompt, mail-html without
    // an explicit rich override) — an app-registered "plain" editor on
    // another clientFeature still wins, last-wins same as columnRenderers.
    contentEditors: {
      plain: PlainContentEditor,
    },
    translations: defaultTranslations,
  };
}
