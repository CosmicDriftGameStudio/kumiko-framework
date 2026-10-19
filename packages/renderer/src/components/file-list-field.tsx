import type { ReactNode } from "react";
import type { EditFieldViewModel } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";

export type FileListFieldProps = {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly kind: "file" | "image";
  readonly onChange: (value: readonly string[]) => void;
  readonly hasError: boolean;
};

function isFileIdList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function readFileIds(value: unknown): readonly string[] {
  if (!isFileIdList(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

export function FileListField({
  field,
  id,
  kind,
  onChange,
  hasError,
}: FileListFieldProps): ReactNode {
  const { Input, Button, Grid, GridCell, Text } = usePrimitives();
  const t = useTranslation();
  const fileIds = readFileIds(field.value);
  // The server accepts repeated ids, so the id alone is not a unique key.
  const keys = fileIds.map(
    (fileId, index) => `${fileId}#${fileIds.slice(0, index).filter((x) => x === fileId).length}`,
  );
  const disabled = field.readOnly;
  const canAdd = !disabled && (field.maxCount === undefined || fileIds.length < field.maxCount);

  const inputProps = {
    kind,
    name: field.field,
    disabled,
    hasError,
    ...(field.accept !== undefined && { accept: field.accept }),
    ...(field.maxSize !== undefined && { maxSize: field.maxSize }),
    ...(field.entityType !== undefined && { entityType: field.entityType }),
    ...(field.entityId !== undefined && { entityId: field.entityId }),
    ...(field.fieldName !== undefined && { fieldName: field.fieldName }),
    ...(kind === "image" &&
      field.imageVariant !== undefined && { imageVariant: field.imageVariant }),
    ...(kind === "image" && field.capture !== undefined && { capture: field.capture }),
  } as const;

  function move(fromIndex: number, toIndex: number): void {
    const next = [...fileIds];
    const [moved] = next.splice(fromIndex, 1);
    if (moved === undefined) return;
    next.splice(toIndex, 0, moved);
    onChange(next);
  }

  return (
    <Grid columns={1} testId={`${id}-file-list`}>
      {fileIds.length === 0 && <Text variant="muted">{t("kumiko.field.file-list.empty")}</Text>}
      {fileIds.map((fileId, index) => (
        <GridCell key={keys[index]}>
          <Input
            {...inputProps}
            id={`${id}-${index}`}
            value={fileId}
            onChange={(next: string | null) => {
              if (next === null) onChange(fileIds.filter((_, i) => i !== index));
              else onChange(fileIds.map((existing, i) => (i === index ? next : existing)));
            }}
          />
          {!disabled && (
            <Grid columns="auto">
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  icon="chevron-up"
                  ariaLabel={t("kumiko.field.file-list.move-up")}
                  testId={`${id}-${index}-move-up`}
                  onClick={() => move(index, index - 1)}
                />
              )}
              {index < fileIds.length - 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  icon="chevron-down"
                  ariaLabel={t("kumiko.field.file-list.move-down")}
                  testId={`${id}-${index}-move-down`}
                  onClick={() => move(index, index + 1)}
                />
              )}
            </Grid>
          )}
        </GridCell>
      ))}
      {canAdd && (
        <GridCell key="add">
          <Text variant="muted">{t("kumiko.field.file-list.add")}</Text>
          <Input
            {...inputProps}
            id={`${id}-add`}
            value={null}
            onChange={(next: string | null) => {
              if (next !== null) onChange([...fileIds, next]);
            }}
          />
        </GridCell>
      )}
    </Grid>
  );
}
