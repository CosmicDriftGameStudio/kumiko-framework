// @runtime client
// FolderManager — in-screen folder tree the user manages directly: create root
// folders + subfolders, rename, delete, collapse/expand. KPI-agnostic: a host
// passes `renderMeta` to hang its own per-folder badges (e.g. money-horse's
// rolled-up Restschuld/Rate) next to each node — the manager knows nothing about
// what's filed in a folder, only the folder tree itself.
//
// Optional `filing` mode: when a host hands in its entities (grouped by folder +
// an unfiled bucket) the manager interleaves them as draggable leaf rows and
// becomes a full filing tree — drag a leaf onto a folder to file it (set-folder),
// onto the unfiled bucket to unfile it (clear-folder). The host owns the entity
// data + stats; the manager owns the folder writes AND the reassignment writes,
// then refetches its own catalog and calls the host's onReassigned to refresh the
// host's assignment-derived data. ponytail: native HTML5 DnD, desktop-only;
// pointer-based (dnd-kit) only if touch filing is ever needed — keyboard filing
// stays available via <FolderSection>.
//
// Finder/Explorer-style: the tree is flattened to its visible rows in DFS order
// and rendered as full-width rows with (a) alternating zebra striping, (b) one
// vertical guide line per ancestor depth, and (c) a disclosure chevron + folder
// icon. The chevron+name toggle a node; expansion state persists in localStorage
// so a reload doesn't re-expand everything. Create/rename happen inline (Enter
// saves); delete asks for confirmation; root folders are added via the in-tree
// "+ new folder" row (no floating toolbar button). Icons are lucide-react.
//
// NOTE on Tailwind: a host's Tailwind v4 build must `@source`-scan this package's
// src (node_modules is ignored by default) or these classes never compile. money-
// horse already does; that scan is a real shipping requirement for any host.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { ChevronRight, File, Folder, type LucideIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useState } from "react";
import { FoldersHandlers, FoldersQueries } from "../constants";
import { buildFolderTree, type FolderNode, type FolderRow } from "./tree";

type FolderListResponse = { readonly rows: readonly FolderRow[] };

// One filed entity, rendered as a draggable leaf under its folder. The host maps
// its rows into these (label + an optional trailing slot for a KPI/amount).
export type FolderLeaf = {
  readonly id: string;
  readonly label: string;
  readonly trailing?: ReactNode;
  readonly onOpen?: () => void;
  // Overrides filing.entityType for this leaf — lets one filing tree hold leaves
  // of mixed entity types (e.g. credits + Bausparverträge), each filed/cleared
  // under its own type. Omit for single-type trees.
  readonly entityType?: string;
};

// Opt-in filing binding. Host computes the grouping (it already holds the
// assignments for its stats); the manager renders + drives the set/clear-folder
// writes and tells the host to refetch via onReassigned.
export type FolderFiling = {
  readonly entityType: string;
  readonly leavesByFolder: ReadonlyMap<string, readonly FolderLeaf[]>;
  readonly unfiled: readonly FolderLeaf[];
  readonly unfiledLabel: string;
  readonly unfiledMeta?: ReactNode;
  readonly leafIcon?: LucideIcon;
  readonly onReassigned: () => Promise<void> | void;
};

const UNFILED = "__unfiled__";
const DRAG_MIME = "text/plain";
// ponytail: one global key — folder expansion is low-stakes UI state shared
// across every folder tree in the app; a per-host key only if trees ever diverge.
const COLLAPSED_KEY = "kumiko:folders:collapsed";

const loadCollapsed = (): ReadonlySet<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

type Pending =
  | { readonly mode: "create"; readonly parentId: string | null }
  | { readonly mode: "rename"; readonly id: string; readonly version: number }
  | null;

export function FolderManager({
  renderMeta,
  filing,
}: {
  // Optional per-folder slot (right side of each row). The host owns the data;
  // the manager just gives it a place to render.
  readonly renderMeta?: (folder: FolderRow) => ReactNode;
  // Optional filing mode: interleave the host's draggable entities + DnD.
  readonly filing?: FolderFiling;
}): ReactNode {
  const { Banner, Button, Dialog, Input, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const catalog = useQuery<FolderListResponse>(FoldersQueries.folderList, {});
  const [pending, setPending] = useState<Pending>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(loadCollapsed);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null);

  // Persist expand/collapse so a reload (F5) doesn't re-expand everything.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // storage unavailable (private mode / quota) — expansion just won't persist
    }
  }, [collapsed]);

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

  // entityId → current folder (null = unfiled) for the drop no-op guard, and
  // entityId → entityType so a mixed-type tree files each leaf under its own type.
  const currentFolderByEntity = new Map<string, string | null>();
  const typeByEntity = new Map<string, string>();
  if (filing !== undefined) {
    const typeOf = (leaf: FolderLeaf): string => leaf.entityType ?? filing.entityType;
    for (const [folderId, leaves] of filing.leavesByFolder)
      for (const leaf of leaves) {
        currentFolderByEntity.set(leaf.id, folderId);
        typeByEntity.set(leaf.id, typeOf(leaf));
      }
    for (const leaf of filing.unfiled) {
      currentFolderByEntity.set(leaf.id, null);
      typeByEntity.set(leaf.id, typeOf(leaf));
    }
  }

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

  // Delete goes through a confirm dialog — a folder can hold filed entries that
  // fall back to "unfiled" when it's gone. Child folders still block outright.
  const requestDelete = (node: FolderNode): void => {
    if (node.children.length > 0) {
      setErrorKey("folders.manager.deleteBlocked");
      return;
    }
    setErrorKey(null);
    setPendingDelete(node);
  };

  const confirmDelete = async (): Promise<void> => {
    const node = pendingDelete;
    setPendingDelete(null);
    if (node === null) return;
    await apply(() => writeOk(FoldersHandlers.deleteFolder, { id: node.id }));
  };

  // Drop a leaf into a folder (set-folder) or the unfiled bucket (clear-folder).
  // No-op if it already lives there (both handlers are idempotent, but a re-set
  // would burn a redundant event).
  const reassign = async (entityId: string, folderId: string | null): Promise<void> => {
    if (filing === undefined) return;
    if ((currentFolderByEntity.get(entityId) ?? null) === folderId) return;
    setErrorKey(null);
    const entityType = typeByEntity.get(entityId) ?? filing.entityType;
    const ok =
      folderId === null
        ? await writeOk(FoldersHandlers.clearFolder, { entityType, entityId })
        : await writeOk(FoldersHandlers.setFolder, {
            folderId,
            entityType,
            entityId,
          });
    if (ok) {
      await catalog.refetch();
      await filing.onReassigned();
    }
  };

  // Drop-target handlers, attached only in filing mode (so plain folder
  // management keeps non-interactive rows).
  const dropProps = (key: string, folderId: string | null) =>
    filing === undefined
      ? {}
      : {
          onDragOver: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverKey(key);
          },
          onDragLeave: (e: DragEvent<HTMLDivElement>) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragOverKey((cur) => (cur === key ? null : cur));
          },
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragOverKey(null);
            const id = e.dataTransfer.getData(DRAG_MIME);
            if (id !== "") void reassign(id, folderId);
          },
        };

  // One vertical guide line per ancestor depth, centered in a chevron-width
  // column; self-stretch fills the padding-free min-h-9 row edge-to-edge, so
  // consecutive rows' lines join into continuous, gapless rails.
  const rails = (depth: number): ReactNode =>
    Array.from({ length: depth }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: positional rail, no identity
      <span key={i} className="flex w-5 shrink-0 justify-center self-stretch" aria-hidden="true">
        <span className="w-px self-stretch bg-border" />
      </span>
    ));

  const rowClass = (stripe: boolean, dropActive: boolean): string =>
    `flex min-h-9 items-center gap-1.5 px-2 transition-colors hover:bg-muted/60 ${
      stripe ? "bg-muted/40" : ""
    } ${dropActive ? "ring-1 ring-inset ring-primary/40" : ""}`;

  const actionButton = (
    label: string,
    testId: string,
    Icon: LucideIcon,
    onClick: () => void,
    danger?: boolean,
  ): ReactNode => (
    // kumiko-lint-ignore primitives-discipline: compact icon action for the Finder-style tree row; the full Button primitive would break the dense single-row layout
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-background disabled:opacity-40 ${
        danger ? "hover:text-destructive" : "hover:text-foreground"
      }`}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );

  // Chevron + folder icon + name = one click target that toggles (cursor-pointer).
  // A non-expandable folder renders the same layout without the toggle affordance.
  const toggleArea = (
    id: string,
    label: string,
    expanded: boolean,
    expandable: boolean,
  ): ReactNode =>
    expandable ? (
      // kumiko-lint-ignore primitives-discipline: dense Finder-row toggle (chevron + name); the Button primitive would break the single-row layout
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggleCollapse(id)}
        data-testid={`folder-toggle-${id}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
      >
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <Folder size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{label}</span>
      </button>
    ) : (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="w-4 shrink-0" />
        <Folder size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{label}</span>
      </div>
    );

  const draftRow = (depth: number, key: string, stripe: boolean): ReactNode => (
    // kumiko-lint-ignore primitives-discipline: native form only to capture Enter-to-submit on the inline draft field
    <form
      key={key}
      className={rowClass(stripe, false)}
      data-testid="folder-manager-draft"
      onSubmit={(e) => {
        e.preventDefault();
        saveDraft();
      }}
    >
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
    </form>
  );

  const leafRow = (leaf: FolderLeaf, depth: number, stripe: boolean): ReactNode => {
    const LeafIcon = filing?.leafIcon ?? File;
    return (
      // kumiko-lint-ignore primitives-discipline: draggable Finder-style leaf row; the Button primitive can't be a dense, full-row drag source
      <button
        key={`leaf-${leaf.id}`}
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, leaf.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={leaf.onOpen}
        className={`${rowClass(stripe, false)} w-full cursor-pointer text-left`}
        data-testid={`folder-leaf-${leaf.id}`}
      >
        {rails(depth)}
        <span className="w-5 shrink-0" />
        <LeafIcon size={16} aria-hidden="true" className="shrink-0 text-muted-foreground/70" />
        <span className="flex-1 truncate">{leaf.label}</span>
        {leaf.trailing}
      </button>
    );
  };

  const folderRow = (node: FolderNode, depth: number, stripe: boolean): ReactNode => {
    const leaves = filing?.leavesByFolder.get(node.id) ?? [];
    const expandable = node.children.length > 0 || leaves.length > 0;
    const expanded = expandable && !collapsed.has(node.id);
    return (
      <div
        key={node.id}
        data-testid={`folder-node-${node.id}`}
        className={rowClass(stripe, dragOverKey === node.id)}
        {...dropProps(node.id, node.id)}
      >
        {rails(depth)}
        {toggleArea(node.id, node.name, expanded, expandable)}
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
            () => requestDelete(node),
            true,
          )}
        </div>
      </div>
    );
  };

  const bucketRow = (stripe: boolean): ReactNode => {
    if (filing === undefined) return null;
    const expanded = !collapsed.has(UNFILED);
    return (
      <div
        key={UNFILED}
        data-testid="folder-node-unfiled"
        className={rowClass(stripe, dragOverKey === UNFILED)}
        {...dropProps(UNFILED, null)}
      >
        {toggleArea(UNFILED, filing.unfiledLabel, expanded, true)}
        {filing.unfiledMeta}
      </div>
    );
  };

  // Subtle in-tree row to add a root folder (replaces the old floating toolbar
  // button, which caused an ugly header jump in hosts with their own actions).
  const newRootRow = (): ReactNode => (
    // kumiko-lint-ignore primitives-discipline: dense Finder-row action (add root folder); the Button primitive would break the row layout
    <button
      type="button"
      disabled={busy}
      onClick={() => openCreate(null)}
      data-testid="folder-manager-new-root"
      className="flex min-h-9 w-full cursor-pointer items-center gap-1.5 px-2 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
    >
      <span className="w-5 shrink-0" />
      <Plus size={16} aria-hidden="true" className="shrink-0" />
      <span className="font-medium">{t("folders.manager.newRoot")}</span>
    </button>
  );

  // Flatten the visible tree (DFS) into ordered rows so the zebra index + guide
  // rails stay correct across depth. A pending rename swaps a node's row in place;
  // a pending create appends a draft row at the end of its parent's children. In
  // filing mode a folder's leaf rows render before its subfolders.
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
      const leaves = filing?.leavesByFolder.get(node.id) ?? [];
      const expandable = node.children.length > 0 || leaves.length > 0;
      if (expandable && !collapsed.has(node.id)) {
        for (const leaf of leaves) out.push(leafRow(leaf, depth + 1, stripeNext()));
        if (node.children.length > 0) walk(node.children, depth + 1);
      }
      if (pending?.mode === "create" && pending.parentId === node.id)
        out.push(draftRow(depth + 1, `create-under-${node.id}`, stripeNext()));
    }
  };
  walk(tree, 0);

  // The bucket itself must stay in the tree even when nothing is currently
  // unfiled — it's the only drop target to un-file a leaf back out of a
  // folder. Regression: #671/5 — an empty `unfiled` array made the bucket
  // vanish entirely, silently removing that escape hatch.
  const hasUnfiled = filing !== undefined;
  if (hasUnfiled) {
    out.push(bucketRow(stripeNext()));
    if (!collapsed.has(UNFILED))
      for (const leaf of filing.unfiled) out.push(leafRow(leaf, 1, stripeNext()));
  }

  const creatingRoot = pending?.mode === "create" && pending.parentId === null;
  if (creatingRoot) out.unshift(draftRow(0, "create-root", false));

  return (
    <div data-testid="folder-manager" className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border">
        {out}
        {!creatingRoot && newRootRow()}
      </div>

      {errorKey !== null && (
        <Banner variant="error" testId="folder-manager-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={t("folders.manager.deleteConfirmTitle")}
        description={t("folders.manager.deleteConfirmBody")}
        confirmLabel={t("folders.manager.delete")}
        cancelLabel={t("folders.manager.cancel")}
        variant="danger"
        onConfirm={confirmDelete}
        testId="folder-manager-delete-dialog"
      />
    </div>
  );
}
