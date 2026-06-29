// @runtime client
// TagManager — the shared tag-catalog UI, GitLab-labels style. Built ONCE,
// mounted twice:
//   - standalone:  <TagManager />                       → the Tags admin screen
//                  (see all labels + create/recolor/re-scope/delete, no select).
//   - in a picker: <TagManager entityType selection />  → adds a select toggle
//                  per (scope-matching) tag and reports the chosen ids back.
//
// Catalog edits (create/update/delete) are immediate writes against the
// per-tenant catalog. Selection is buffered by the caller (TagPicker) and only
// applied on confirm — managing labels and picking them are separate concerns.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { TagsHandlers, TagsQueries } from "../constants";
import { TagChip } from "./tag-chip";

type TagRow = {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly scope?: string | null;
  readonly version: number;
};
type AssignmentRow = { readonly tagId: string };

// A small fixed palette so labels stay visually distinct without a color-wheel
// dependency; the hex field below still accepts any custom value.
const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#6b7280",
] as const;

type Selection = {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
};

function ColorPicker({
  value,
  onChange,
  idPrefix,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly idPrefix: string;
}): ReactNode {
  const { Input } = usePrimitives();
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((c) => (
          // kumiko-lint-ignore primitives-discipline color swatch needs a raw colored button — Button is variant-styled
          <button
            key={c}
            type="button"
            aria-label={c}
            data-testid={`${idPrefix}-swatch-${c}`}
            onClick={() => onChange(c)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: c,
              border: value.toLowerCase() === c ? "2px solid #111827" : "1px solid #d1d5db",
            }}
          />
        ))}
      </div>
      <div className="w-28">
        <Input
          kind="text"
          id={`${idPrefix}-hex`}
          name={`${idPrefix}-hex`}
          value={value}
          onChange={onChange}
          placeholder="#22cc88"
        />
      </div>
    </div>
  );
}

export function TagManager({
  entityType,
  selection,
}: {
  readonly entityType?: string;
  readonly selection?: Selection;
}): ReactNode {
  const { Banner, Button, Field, Input, Dialog, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();

  const catalog = useQuery<{ rows: readonly TagRow[] }>(TagsQueries.tagList, {});
  const assignments = useQuery<{ rows: readonly AssignmentRow[] }>(TagsQueries.assignmentList, {});

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newScope, setNewScope] = useState(entityType ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editScope, setEditScope] = useState("");
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (catalog.loading && catalog.data === null) {
    return (
      <Banner variant="loading" testId="tag-manager-loading">
        <Text>{t("tags.section.loading")}</Text>
      </Banner>
    );
  }
  const queryError = catalog.error ?? assignments.error;
  if (queryError) {
    return (
      <Banner variant="error" testId="tag-manager-error">
        <Text>{t(queryError.i18nKey, queryError.i18nParams)}</Text>
      </Banner>
    );
  }

  const usage = new Map<string, number>();
  for (const a of assignments.data?.rows ?? []) usage.set(a.tagId, (usage.get(a.tagId) ?? 0) + 1);

  const selecting = selection !== undefined;
  const allTags = catalog.data?.rows ?? [];
  const tags = selecting
    ? allTags.filter((tag) => {
        const scope = tag.scope ?? "";
        return scope === "" || scope === entityType;
      })
    : allTags;

  const refetch = async (): Promise<void> => {
    await Promise.all([catalog.refetch(), assignments.refetch()]);
  };

  const apply = async (writes: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      if (await writes()) await refetch();
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

  const createTag = (): void => {
    const name = newName.trim();
    if (name === "") return;
    void apply(async () => {
      const created = await dispatcher.write<{ id: string }>(TagsHandlers.createTag, {
        name,
        ...(newColor.trim() !== "" && { color: newColor.trim() }),
        ...(newScope.trim() !== "" && { scope: newScope.trim() }),
      });
      if (!created.isSuccess) {
        setErrorKey(created.error.i18nKey);
        return false;
      }
      setNewName("");
      setNewColor("");
      if (selection !== undefined) selection.onChange([...selection.value, created.data.id]);
      return true;
    });
  };

  const startEdit = (tag: TagRow): void => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color ?? "");
    setEditScope(tag.scope ?? "");
  };

  const saveEdit = (tag: TagRow): void => {
    const name = editName.trim();
    if (name === "") return;
    void apply(async () => {
      const ok = await writeOk(TagsHandlers.updateTag, {
        id: tag.id,
        version: tag.version,
        name,
        color: editColor.trim(),
        scope: editScope.trim(),
      });
      if (ok) setEditingId(null);
      return ok;
    });
  };

  const confirmDelete = async (): Promise<void> => {
    const target = deleting;
    if (target === null) return;
    await apply(async () => {
      const ok = await writeOk(TagsHandlers.deleteTag, { id: target.id });
      if (ok && selection?.value.includes(target.id)) {
        selection.onChange(selection.value.filter((id) => id !== target.id));
      }
      return ok;
    });
    setDeleting(null);
  };

  const toggle = (id: string): void => {
    if (selection === undefined) return;
    const has = selection.value.includes(id);
    selection.onChange(has ? selection.value.filter((x) => x !== id) : [...selection.value, id]);
  };

  return (
    <div data-testid="tag-manager" className="flex flex-col gap-4">
      {/* Create row */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Field id="tag-manager-new-name" label={t("tags.manage.newLabel")}>
          <Input
            kind="text"
            id="tag-manager-new-name"
            name="newTagName"
            value={newName}
            onChange={setNewName}
            placeholder={t("tags.manage.namePlaceholder")}
          />
        </Field>
        <ColorPicker value={newColor} onChange={setNewColor} idPrefix="tag-manager-new-color" />
        {!selecting && (
          <Field id="tag-manager-new-scope" label={t("tags.manage.scopeLabel")}>
            <Input
              kind="text"
              id="tag-manager-new-scope"
              name="newTagScope"
              value={newScope}
              onChange={setNewScope}
              placeholder={t("tags.manage.scopePlaceholder")}
            />
          </Field>
        )}
        <div>
          <Button
            variant="primary"
            disabled={busy || newName.trim() === ""}
            onClick={() => createTag()}
            testId="tag-manager-create"
          >
            {busy ? t("tags.section.working") : t("tags.manage.create")}
          </Button>
        </div>
      </div>

      {/* Catalog list */}
      {tags.length === 0 ? (
        <Banner variant="info" testId="tag-manager-empty">
          <Text>{t("tags.section.empty")}</Text>
        </Banner>
      ) : (
        <div className="flex flex-col gap-1">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <div
                key={tag.id}
                data-testid={`tag-manager-edit-${tag.id}`}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <Input
                  kind="text"
                  id={`tag-edit-name-${tag.id}`}
                  name="editName"
                  value={editName}
                  onChange={setEditName}
                />
                <ColorPicker
                  value={editColor}
                  onChange={setEditColor}
                  idPrefix={`tag-edit-color-${tag.id}`}
                />
                <Input
                  kind="text"
                  id={`tag-edit-scope-${tag.id}`}
                  name="editScope"
                  value={editScope}
                  onChange={setEditScope}
                  placeholder={t("tags.manage.scopePlaceholder")}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => saveEdit(tag)}
                    testId={`tag-manager-save-${tag.id}`}
                  >
                    {t("tags.manage.save")}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setEditingId(null)}>
                    {t("tags.manage.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={tag.id}
                data-testid={`tag-manager-row-${tag.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
              >
                {selecting && (
                  <Button
                    variant={selection?.value.includes(tag.id) ? "primary" : "secondary"}
                    onClick={() => toggle(tag.id)}
                    testId={`tag-manager-toggle-${tag.id}`}
                  >
                    {selection?.value.includes(tag.id) ? "✓" : "+"}
                  </Button>
                )}
                <TagChip name={tag.name} color={tag.color} />
                {!selecting && (tag.scope ?? "") !== "" && (
                  <Text variant="small">{`@${tag.scope}`}</Text>
                )}
                <Text variant="small">
                  {t("tags.manage.usage", { count: usage.get(tag.id) ?? 0 })}
                </Text>
                <div className="ml-auto flex gap-1">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => startEdit(tag)}
                    testId={`tag-manager-edit-btn-${tag.id}`}
                  >
                    {t("tags.manage.edit")}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => setDeleting(tag)}
                    testId={`tag-manager-delete-btn-${tag.id}`}
                  >
                    {t("tags.manage.delete")}
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {errorKey !== null && (
        <Banner variant="error" testId="tag-manager-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("tags.manage.deleteConfirmTitle", { name: deleting?.name ?? "" })}
        description={t("tags.manage.deleteConfirmDesc", {
          count: usage.get(deleting?.id ?? "") ?? 0,
        })}
        confirmLabel={t("tags.manage.delete")}
        variant="danger"
        onConfirm={confirmDelete}
        testId="tag-manager-delete-dialog"
      />
    </div>
  );
}
