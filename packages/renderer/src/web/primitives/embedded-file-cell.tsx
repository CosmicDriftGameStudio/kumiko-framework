// File/image cell of an embedded list row: thumbs plus an add tile. The value is a fileRef id
// array; uploads carry the list's field name and the cell's `subField` so the server can
// resolve the sub-field's accept/maxSize and attach the ref to the right slot.

import { Loader2, Plus, X } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { fileIdsOf } from "../../file-ids-of.ts";
import type { EmbeddedListColumn, EmbeddedListInputProps } from "../../index.ts";
import { useSessionEndedSignal, useTranslation } from "../../index.ts";
import { toAcceptAttr } from "../lib/accept-attr.ts";
import { cn } from "../lib/cn.ts";
import { resizeImageBeforeUpload } from "../lib/resize-image.ts";
import { uploadErrorKey } from "../lib/upload-error-key.ts";
import { isSessionEndedUploadError, uploadFileRef } from "../lib/upload-file-ref.ts";
import { FileNameLink, FileThumbnail } from "./file-thumbnail.tsx";

export function EmbeddedFileCell({
  cellId,
  label,
  column,
  value,
  readOnly,
  uploadTarget,
  onChange,
}: {
  readonly cellId: string;
  readonly label: string;
  readonly column: EmbeddedListColumn;
  readonly value: unknown;
  readonly readOnly: boolean;
  readonly uploadTarget: EmbeddedListInputProps["uploadTarget"];
  readonly onChange: (value: unknown) => void;
}): ReactNode {
  const t = useTranslation();
  const sessionEnded = useSessionEndedSignal();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = fileIdsOf(value);
  const isImage = column.type === "images";
  const canAdd =
    !readOnly &&
    uploadTarget !== undefined &&
    (column.maxCount === undefined || ids.length < column.maxCount);
  const acceptAttr = toAcceptAttr(column.accept);

  async function onPick(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (file === undefined || uploadTarget === undefined) return;
    setUploading(true);
    setError(null);
    try {
      const uploadFile = await resizeImageBeforeUpload(file);
      const id = await uploadFileRef(uploadFile, { ...uploadTarget, subField: column.field });
      onChange([...ids, id]);
    } catch (cause) {
      if (isSessionEndedUploadError(cause)) sessionEnded?.notify();
      setError(t(uploadErrorKey(cause)));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div data-cell-id={cellId} className="flex min-w-0 flex-wrap items-center gap-2">
      {ids.map((fileId) => (
        <div key={fileId} className="relative">
          {isImage ? (
            <FileThumbnail fileId={fileId} className="size-16" />
          ) : (
            <FileNameLink fileId={fileId} fallbackLabel={t("kumiko.field.file-upload.attached")} />
          )}
          {!readOnly && (
            <button
              type="button"
              aria-label={t("kumiko.field.file-upload.remove")}
              className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground"
              onClick={() => onChange(ids.filter((id) => id !== fileId))}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {canAdd && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            {...(acceptAttr !== undefined && { accept: acceptAttr })}
            {...(column.capture !== undefined && { capture: column.capture })}
            onChange={(e) => void onPick(e)}
          />
          <button
            type="button"
            aria-label={`${label}: ${t("kumiko.field.file-upload.upload")}`}
            disabled={uploading}
            className={cn(
              "flex size-16 items-center justify-center rounded-md border border-dashed text-muted-foreground",
            )}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-5" aria-hidden="true" />
            )}
          </button>
        </>
      )}
      {error !== null && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  );
}
