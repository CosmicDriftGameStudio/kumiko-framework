// @runtime client
// FolderSection — drop-in single-folder picker for ANY entity. Unlike tags
// (many-to-many multi-combobox), an entity lives in exactly ONE folder, so this
// is a single-select combobox with a "no folder" option plus a compact row to
// create-and-file a brand-new folder. Folder writes are immediate (set/clear are
// idempotent), so the section owns its state and refetches after each action —
// it is NOT part of a host form's save.
//
// Two ways to mount (both need foldersClient() registered once, for i18n):
//   - standalone:   <FolderSection entityName="credit" entityId={creditId} />
//   - extension:    a screen-schema section with
//                   component: { react: { __component: FOLDER_SECTION_EXTENSION_NAME } }
//                   (RenderEdit passes { entityName, entityId }).

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { FoldersHandlers, FoldersQueries } from "../constants";
import { type FolderRow, folderPath } from "./tree";

type AssignmentRow = {
  readonly folderId: string;
  readonly entityType: string;
  readonly entityId: string;
};
type FolderListResponse = { readonly rows: readonly FolderRow[] };
type AssignmentListResponse = { readonly rows: readonly AssignmentRow[] };

// Sentinel for the "no folder" combobox option — selecting it clears the
// assignment. Empty string can't collide with a folder id (uuid).
const NO_FOLDER = "";

export function FolderSection({
  entityName,
  entityId,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
}): ReactNode {
  const { Banner, Button, Field, Input, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const enabled = entityId !== null;
  const catalog = useQuery<FolderListResponse>(FoldersQueries.folderList, {}, { enabled });
  const assignments = useQuery<AssignmentListResponse>(
    FoldersQueries.assignmentList,
    { filter: { field: "entityId", op: "eq", value: entityId } },
    { enabled },
  );
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (entityId === null) {
    return (
      <Banner variant="info" testId="folder-section-create-mode">
        <Text>{t("folders.section.createMode")}</Text>
      </Banner>
    );
  }
  if (
    (catalog.loading && catalog.data === null) ||
    (assignments.loading && assignments.data === null)
  ) {
    return (
      <Banner variant="loading" testId="folder-section-loading">
        <Text>{t("folders.section.loading")}</Text>
      </Banner>
    );
  }
  const queryError = catalog.error ?? assignments.error;
  if (queryError) {
    return (
      <Banner variant="error" testId="folder-section-error">
        <Text>{t(queryError.i18nKey, queryError.i18nParams)}</Text>
      </Banner>
    );
  }

  const folders = catalog.data?.rows ?? [];
  const currentFolderId =
    (assignments.data?.rows ?? []).find((r) => r.entityType === entityName)?.folderId ?? NO_FOLDER;
  const options = [
    { value: NO_FOLDER, label: t("folders.section.none") },
    ...folders.map((f) => ({ value: f.id, label: folderPath(folders, f.id) })),
  ];

  const refetch = async (): Promise<void> => {
    await Promise.all([catalog.refetch(), assignments.refetch()]);
  };

  const apply = async (write: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      if (await write()) await refetch();
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

  const onSelect = (next: string): void => {
    if (next === currentFolderId) return;
    void apply(() =>
      next === NO_FOLDER
        ? writeOk(FoldersHandlers.clearFolder, { entityType: entityName, entityId })
        : writeOk(FoldersHandlers.setFolder, { folderId: next, entityType: entityName, entityId }),
    );
  };

  const createAndFile = (): void => {
    const name = newName.trim();
    if (name === "") return;
    void apply(async () => {
      const created = await dispatcher.write<{ id: string }>(FoldersHandlers.createFolder, {
        name,
      });
      if (!created.isSuccess) {
        setErrorKey(created.error.i18nKey);
        return false;
      }
      if (
        !(await writeOk(FoldersHandlers.setFolder, {
          folderId: created.data.id,
          entityType: entityName,
          entityId,
        }))
      ) {
        return false;
      }
      setNewName("");
      return true;
    });
  };

  return (
    <div data-testid="folder-section" className="flex flex-col gap-4">
      <Field id="folder-section-select" label={t("folders.section.label")}>
        <Input
          kind="combobox"
          id="folder-section-select"
          name="folder"
          options={options}
          value={currentFolderId}
          onChange={onSelect}
          disabled={busy}
          placeholder={t("folders.section.placeholder")}
          emptyText={t("folders.section.empty")}
        />
      </Field>

      {/* Inline create-row: das Ordner-Input wächst, der Anlegen-Button sitzt
          rechts daneben. ponytail: separate Zeile, weil die Combobox keine
          create-on-type-Affordance hat — fold-in, wenn renderer-web ein
          onCreate-Prop bekommt. */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field id="folder-section-new" label={t("folders.section.newLabel")}>
            <Input
              kind="text"
              id="folder-section-new"
              name="newFolder"
              value={newName}
              onChange={setNewName}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          disabled={busy || newName.trim() === ""}
          onClick={() => createAndFile()}
          testId="folder-section-create"
        >
          {busy ? t("folders.section.working") : t("folders.section.create")}
        </Button>
      </div>

      {errorKey !== null && (
        <Banner variant="error" testId="folder-section-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );
}
