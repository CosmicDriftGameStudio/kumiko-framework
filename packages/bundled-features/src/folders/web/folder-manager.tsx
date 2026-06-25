// @runtime client
// FolderManager — in-screen folder tree the user manages directly: create root
// folders + subfolders, rename, delete, collapse/expand. KPI-agnostic: a host
// passes `renderMeta` to hang its own per-folder badges (e.g. money-horse's
// rolled-up Restschuld/Rate) next to each node — the manager knows nothing about
// what's filed in a folder, only the folder tree itself.
//
// Finder/Explorer-style: the tree is flattened to its visible rows in DFS order
// and rendered as full-width rows with (a) alternating zebra striping, (b) one
// vertical guide line per ancestor depth, and (c) a disclosure chevron + folder
// icon. Icons are lucide-react (the same set the nav's NAV_ICONS uses), so they
// match the rest of the app. Actions are compact always-visible icon buttons (NOT
// hover-only — static screenshots can't hover). Flattening (vs nested divs) is
// what lets the zebra + guide lines run edge-to-edge and stay aligned regardless
// of depth.
//
// NOTE on Tailwind: a host's Tailwind v4 build must `@source`-scan this package's
// src (node_modules is ignored by default) or these classes never compile. money-
// horse already does; that scan is a real shipping requirement for any host.
//
// Folder writes are immediate; the manager owns its catalog query and refetches
// after each action.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  type LucideIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { FoldersHandlers, FoldersQueries } from "../constants";
import { buildFolderTree, type FolderNode, type FolderRow } from "./tree";

type FolderListResponse = { readonly rows: readonly FolderRow[] };

type Pending =
  | { readonly mode: "create"; readonly parentId: string | null }
  | { readonly mode: "rename"; readonly id: string; readonly version: number }
  | null;

export function FolderManager({
  renderMeta,
}: {
  // Optional per-folder slot (right side of each row). The host owns the data;
  // the manager just gives it a place to render.
  readonly renderMeta?: (folder: FolderRow) => ReactNode;
}): ReactNode {
  const { Banner, Button, Input, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const catalog = useQuery<FolderListResponse>(FoldersQueries.folderList, {});
  const [pending, setPending] = useState<Pending>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (catalog.loading && catalog.data === null) {
    return (
      <Banner variant="loading" testId="folder-manager-loading">
        <Text>{t("folders.manager.loading")}</Text>
      </Banner>
    );
  }
  if (catalog.error) {
    return (
      <Banner variant="error" testId="folder-manager-error">
        <Text>{t(catalog.error.i18nKey, catalog.error.i18nParams)}</Text>
      </Banner>
    );
  }

  const rows = catalog.data?.rows ?? [];
  const tree = buildFolderTree(rows);

  const toggleCollapse = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = (parentId: string | null): void => {
    setErrorKey(null);
    setDraftName("");
    setPending({ mode: "create", parentId });
    if (parentId !== null)
      setCollapsed((prev) => new Set([...prev].filter((id) => id !== parentId)));
  };

  const openRename = (folder: FolderRow): void => {
    setErrorKey(null);
    setDraftName(folder.name);
    setPending({ mode: "rename", id: folder.id, version: folder.version });
  };

  const apply = async (write: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      if (await write()) {
        setPending(null);
        await catalog.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  const writeOk = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const result = await dispatcher.write(type, payload);
    if (!result.isSuccess) {
      setErrorKey(result.error.i18nKey);
      return false;
    }
    return true;
  };

  const saveDraft = (): void => {
    const name = draftName.trim();
    if (name === "" || pending === null) return;
    const p = pending;
    void apply(() =>
      p.mode === "create"
        ? writeOk(
            FoldersHandlers.createFolder,
            p.parentId === null ? { name } : { name, parentId: p.parentId },
          )
        : writeOk(FoldersHandlers.updateFolder, {
            id: p.id,
            version: p.version,
            changes: { name },
          }),
    );
  };

  const deleteFolder = (node: FolderNode): void => {
    if (node.children.length > 0) {
      setErrorKey("folders.manager.deleteBlocked");
      return;
    }
    void apply(() => writeOk(FoldersHandlers.deleteFolder, { id: node.id }));
  };

  // One vertical guide line per ancestor depth, centered in a chevron-width column;
  // self-stretch makes consecutive rows' lines join into continuous rails.
  const rails = (depth: number): ReactNode =>
    Array.from({ length: depth }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: positional rail, no identity
      <span key={i} className="flex w-5 shrink-0 justify-center self-stretch" aria-hidden="true">
        <span className="w-px self-stretch bg-border" />
      </span>
    ));

  const rowClass = (stripe: boolean): string =>
    `flex items-center gap-1.5 px-2 py-1.5 transition-colors hover:bg-muted/60 ${
      stripe ? "bg-muted/40" : ""
    }`;

  const actionButton = (
    label: string,
    testId: string,
    Icon: LucideIcon,
    onClick: () => void,
    danger?: boolean,
  ): ReactNode => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`rounded p-1 text-muted-foreground transition-colors hover:bg-background disabled:opacity-40 ${
        danger ? "hover:text-destructive" : "hover:text-foreground"
      }`}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );

  const draftRow = (depth: number, key: string, stripe: boolean): ReactNode => (
    <div key={key} className={rowClass(stripe)} data-testid="folder-manager-draft">
      {rails(depth)}
      <Folder size={16} aria-hidden="true" className="shrink-0 text-muted-foreground/50" />
      <div className="flex-1">
        <Input
          kind="text"
          id="folder-manager-draft"
          name="folderName"
          value={draftName}
          onChange={setDraftName}
          placeholder={t("folders.manager.newRoot")}
        />
      </div>
      <Button
        variant="primary"
        disabled={busy || draftName.trim() === ""}
        onClick={() => saveDraft()}
        testId="folder-manager-save"
      >
        {busy ? t("folders.manager.working") : t("folders.manager.save")}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>
        {t("folders.manager.cancel")}
      </Button>
    </div>
  );

  const folderRow = (node: FolderNode, depth: number, stripe: boolean): ReactNode => {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.id);
    return (
      <div key={node.id} data-testid={`folder-node-${node.id}`} className={rowClass(stripe)}>
        {rails(depth)}
        {hasChildren ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-expanded={expanded}
            onClick={() => toggleCollapse(node.id)}
            data-testid={`folder-toggle-${node.id}`}
          >
            {expanded ? (
              <ChevronDown size={16} aria-hidden="true" />
            ) : (
              <ChevronRight size={16} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Folder size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{node.name}</span>
        {renderMeta?.(node)}
        <div className="flex items-center gap-0.5">
          {actionButton(t("folders.manager.addChild"), `folder-add-child-${node.id}`, Plus, () =>
            openCreate(node.id),
          )}
          {actionButton(t("folders.manager.rename"), `folder-rename-${node.id}`, Pencil, () =>
            openRename(node),
          )}
          {actionButton(
            t("folders.manager.delete"),
            `folder-delete-${node.id}`,
            Trash2,
            () => deleteFolder(node),
            true,
          )}
        </div>
      </div>
    );
  };

  // Flatten the visible tree (DFS) into ordered rows so the zebra index + guide
  // rails stay correct across depth. A pending rename swaps a node's row in place;
  // a pending create appends a draft row at the end of its parent's children.
  const out: ReactNode[] = [];
  let idx = 0;
  const stripeNext = (): boolean => {
    const stripe = idx % 2 === 1;
    idx += 1;
    return stripe;
  };
  const walk = (nodes: readonly FolderNode[], depth: number): void => {
    for (const node of nodes) {
      const renaming = pending?.mode === "rename" && pending.id === node.id;
      out.push(
        renaming
          ? draftRow(depth, `rename-${node.id}`, stripeNext())
          : folderRow(node, depth, stripeNext()),
      );
      if (node.children.length > 0 && !collapsed.has(node.id)) walk(node.children, depth + 1);
      if (pending?.mode === "create" && pending.parentId === node.id)
        out.push(draftRow(depth + 1, `create-under-${node.id}`, stripeNext()));
    }
  };
  walk(tree, 0);

  const creatingRoot = pending?.mode === "create" && pending.parentId === null;
  if (creatingRoot) out.unshift(draftRow(0, "create-root", false));

  return (
    <div data-testid="folder-manager" className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={busy || creatingRoot}
          onClick={() => openCreate(null)}
          testId="folder-manager-new-root"
        >
          {t("folders.manager.newRoot")}
        </Button>
      </div>

      {tree.length === 0 && !creatingRoot ? (
        <Banner variant="info" testId="folder-manager-empty">
          <Text>{t("folders.manager.empty")}</Text>
        </Banner>
      ) : (
        <div className="overflow-hidden rounded-md border">{out}</div>
      )}

      {errorKey !== null && (
        <Banner variant="error" testId="folder-manager-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );
}
