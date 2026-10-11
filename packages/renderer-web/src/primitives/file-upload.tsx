// File/image upload widget for the auto-edit form. Uploads via multipart POST
// to /api/files (mounted by the stack when a storageProvider is set), gets the
// FileRef UUID back and lifts it up as the field value. Image → round avatar
// preview (GET /api/files/:id, or the declared variant), file → file name.

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr.js";
import { buildFileUploadFormData } from "../lib/file-upload-form-data.js";
import { resizeImageBeforeUpload } from "../lib/resize-image.js";
import { Button as UiButton } from "../ui/button.js";

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
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || json.id === undefined) {
        setError(json.error ?? t("kumiko.field.file-upload.failed"));
        return;
      }
      onChange(json.id);
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
      {kind === "image" &&
        (value !== null ? (
          <img
            src={
              imageVariant !== undefined
                ? `/api/files/${value}/variant/${imageVariant}`
                : `/api/files/${value}`
            }
            alt=""
            className="size-16 rounded-full border object-cover"
          />
        ) : (
          <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full border">
            <ImageIcon className="size-6" />
          </div>
        ))}
      {kind === "file" && value !== null && (
        <span className="text-muted-foreground text-sm">
          {t("kumiko.field.file-upload.attached")}
        </span>
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
      <UiButton
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled === true || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {value !== null
          ? t("kumiko.field.file-upload.change")
          : t("kumiko.field.file-upload.upload")}
      </UiButton>
      {value !== null && (
        <UiButton type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("kumiko.field.file-upload.remove")}
        </UiButton>
      )}
      {error !== null && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
