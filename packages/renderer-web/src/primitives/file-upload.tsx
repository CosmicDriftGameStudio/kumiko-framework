// File/image upload widget for the auto-edit form. Uploads via multipart POST
// to /api/files (mounted by the stack when a storageProvider is set), gets the
// FileRef UUID back and lifts it up as the field value. Image → uncropped
// rectangular preview (GET /api/files/:id, or the declared variant), file →
// file name link. A disabled input shows the value only, without controls.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr.js";
import { resizeImageBeforeUpload } from "../lib/resize-image.js";
import { FileUploadFailedError, uploadFileRef } from "../lib/upload-file-ref.js";
import { Button as UiButton } from "../ui/button.js";
import { FileNameLink, FileThumbnail } from "./file-thumbnail.js";

export type FileUploadInputProps = {
  readonly kind: "file" | "image";
  readonly id: string;
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly accept?: readonly string[];
  readonly disabled?: boolean;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly fieldName?: string;
  readonly imageVariant?: string;
  readonly capture?: "environment" | "user";
  /** Folder picker (web-only, `webkitdirectory`): hands the picked files with
   *  `webkitRelativePath` to `onFilesPicked` and uploads nothing. */
  readonly directory?: boolean;
  readonly onFilesPicked?: (files: readonly File[]) => void;
  readonly pickLabel?: string;
  readonly testId?: string;
};

// React's input typings have no `webkitdirectory`; spreading keeps it typed-cast-free.
const DIRECTORY_INPUT_ATTRS = { webkitdirectory: "", multiple: true };

export function FileUploadInput({
  kind,
  id,
  value,
  onChange,
  accept,
  disabled,
  entityType,
  entityId,
  fieldName,
  imageVariant,
  capture,
  directory,
  onFilesPicked,
  pickLabel,
  testId,
}: FileUploadInputProps): ReactNode {
  const t = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    if (directory === true) {
      onFilesPicked?.(Array.from(e.target.files ?? []));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const file = e.target.files?.[0];
    if (file === undefined) return;
    setUploading(true);
    setError(null);
    try {
      const uploadFile = await resizeImageBeforeUpload(file);
      onChange(await uploadFileRef(uploadFile, { entityType, entityId, fieldName }));
    } catch (error) {
      setError(
        error instanceof FileUploadFailedError && error.fromServer
          ? error.message
          : t("kumiko.field.file-upload.failed"),
      );
    } finally {
      setUploading(false);
      // Clear the input so re-picking the SAME file still fires change — the
      // browser suppresses the event otherwise (no-op in jsdom, real-browser).
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const acceptAttr = toAcceptAttr(accept);

  return (
    <div className="flex items-center gap-4">
      {kind === "image" && value !== null && (
        <FileThumbnail
          fileId={value}
          {...(imageVariant !== undefined && { variant: imageVariant })}
        />
      )}
      {kind === "image" && value === null && (
        <div className="bg-muted text-muted-foreground flex h-24 w-32 items-center justify-center rounded-md border">
          <ImageIcon className="size-6" />
        </div>
      )}
      {kind === "file" && value !== null && (
        <FileNameLink fileId={value} fallbackLabel={t("kumiko.field.file-upload.attached")} />
      )}
      <input
        ref={inputRef}
        id={id}
        {...(testId !== undefined && { "data-testid": `${testId}-input` })}
        type="file"
        className="hidden"
        {...(acceptAttr !== undefined && { accept: acceptAttr })}
        {...(capture !== undefined && { capture })}
        {...(directory === true && DIRECTORY_INPUT_ATTRS)}
        onChange={(e) => void onPick(e)}
        disabled={disabled}
      />
      {disabled !== true && (
        <>
          <UiButton
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            {...(testId !== undefined && { "data-testid": `${testId}-pick` })}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {pickLabel ??
              (value !== null
                ? t("kumiko.field.file-upload.change")
                : t("kumiko.field.file-upload.upload"))}
          </UiButton>
          {value !== null && (
            <UiButton type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {t("kumiko.field.file-upload.remove")}
            </UiButton>
          )}
        </>
      )}
      {error !== null && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
