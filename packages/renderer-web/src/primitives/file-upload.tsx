// File/image upload widget for the auto-edit form. Uploads via multipart POST
// to /api/files (mounted by the stack when a storageProvider is set), gets the
// FileRef UUID back and lifts it up as the field value. Image → uncropped
// rectangular preview (GET /api/files/:id, or the declared variant), file →
// file name link. A disabled input shows the value only, without controls.

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr.js";
import { buildFileUploadFormData } from "../lib/file-upload-form-data.js";
import { resizeImageBeforeUpload } from "../lib/resize-image.js";
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
};

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
}: FileUploadInputProps): ReactNode {
  const t = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    setUploading(true);
    setError(null);
    try {
      const uploadFile = await resizeImageBeforeUpload(file);
      const fd = buildFileUploadFormData({ file: uploadFile, entityType, entityId, fieldName });
      // Double-Submit-CSRF wie der Dispatcher: kumiko_csrf-Cookie → Header.
      const csrf = readCsrfToken();
      const res = await fetch("/api/files", {
        method: "POST",
        body: fd,
        ...(csrf !== undefined && { headers: { [CSRF_HEADER_NAME]: csrf } }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const id = propertyOf(json, "id");
      if (!res.ok || typeof id !== "string") {
        const message = propertyOf(json, "error");
        setError(typeof message === "string" ? message : t("kumiko.field.file-upload.failed"));
        return;
      }
      onChange(id);
    } catch {
      setError(t("kumiko.field.file-upload.failed"));
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
        type="file"
        className="hidden"
        {...(acceptAttr !== undefined && { accept: acceptAttr })}
        {...(capture !== undefined && { capture })}
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
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {value !== null
              ? t("kumiko.field.file-upload.change")
              : t("kumiko.field.file-upload.upload")}
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
