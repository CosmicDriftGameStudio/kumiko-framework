// File/image upload widget for the auto-edit form. Uploads via multipart POST
// to /api/files (mounted by the stack when a storageProvider is set), gets the
// FileRef UUID back and lifts it up as the field value. Image → round avatar
// preview (GET /api/files/:id, or the declared variant), file → file name.

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr";
import { resizeImageBeforeUpload } from "../lib/resize-image";
import { Button as UiButton } from "../ui/button";

export type FileUploadInputProps = {
  readonly kind: "file" | "image";
  readonly id: string;
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly accept?: readonly string[];
  readonly disabled?: boolean;
  readonly entityType?: string;
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
  fieldName,
  imageVariant,
  capture,
}: FileUploadInputProps): ReactNode {
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
      const fd = new FormData();
      fd.append("file", uploadFile);
      if (entityType !== undefined) fd.append("entityType", entityType);
      if (fieldName !== undefined) fd.append("fieldName", fieldName);
      // Double-Submit-CSRF wie der Dispatcher: kumiko_csrf-Cookie → Header.
      const csrf = readCsrfToken();
      const res = await fetch("/api/files", {
        method: "POST",
        body: fd,
        ...(csrf !== undefined && { headers: { [CSRF_HEADER_NAME]: csrf } }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || json.id === undefined) {
        setError(json.error ?? "upload_failed");
        return;
      }
      onChange(json.id);
    } catch {
      setError("upload_failed");
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
        <span className="text-muted-foreground text-sm">File attached</span>
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
        {value !== null ? "Change" : "Upload"}
      </UiButton>
      {value !== null && (
        <UiButton type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Remove
        </UiButton>
      )}
      {error !== null && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
