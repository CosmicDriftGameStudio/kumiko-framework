import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { CheckCircle2, FileUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr";
import { cn } from "../lib/cn";
import { resizeImageBeforeUpload } from "../lib/resize-image";

type UploadRowStatus = "uploading" | "done" | "error";

type UploadRow = {
  readonly id: string;
  readonly fileName: string;
  readonly status: UploadRowStatus;
  readonly error?: string;
};

const STATUS_ICON: Record<UploadRowStatus, ReactNode> = {
  uploading: <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />,
  done: <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />,
  error: <TriangleAlert className="size-3.5 text-destructive" aria-hidden="true" />,
};

const STATUS_LABEL_KEY: Record<UploadRowStatus, string> = {
  uploading: "kumiko.widget.upload.uploading",
  done: "kumiko.widget.upload.done",
  error: "kumiko.widget.upload.error",
};

export type UploadZoneProps = {
  /** Uploads a single file (POST + optional follow-up mutation). Throws on
   *  failure — the message ends up in the row's error line. Runs in
   *  parallel per file within a batch (no sequential waiting). */
  readonly onUpload: (file: File) => Promise<void>;
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  readonly accept?: readonly string[];
  /** Allow multiple files per pick/drop. Defaults to true. */
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
};

// `accept` on the native <input> only filters the file-picker dialog — a
// drag&drop drop is never routed through it, so any file type lands in
// `onUpload` regardless of what `accept` promises. Same matching rules as
// the native attribute: MIME type (with an optional "type/*" wildcard) or
// file extension.
function matchesAccept(file: File, accept?: readonly string[]): boolean {
  if (accept === undefined || accept.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((raw) => {
    const a = raw.toLowerCase();
    if (a.includes("/")) return a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a;
    return name.endsWith(a.startsWith(".") ? a : `.${a}`);
  });
}

function partitionByAccept(
  files: readonly File[],
  accept: readonly string[] | undefined,
): readonly [accepted: readonly File[], rejected: readonly File[]] {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) (matchesAccept(file, accept) ? accepted : rejected).push(file);
  return [accepted, rejected];
}

/** Drop zone + multi-file picker with a per-file status row (uploading/done/
 *  error). For screens that accept several files and upload them
 *  independently — unlike `FileField` (single file, FileRef value inside a
 *  form field). `onUpload` decides what "upload" means (storage POST, ingest
 *  mutation, or both); the zone only tracks uploading/done/error. */
export function UploadZone({
  onUpload,
  title,
  hint,
  accept,
  multiple = true,
  disabled,
  testId,
}: UploadZoneProps): ReactNode {
  const t = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<readonly UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // `crypto.randomUUID` only exists in a secure context — a plain-HTTP LAN
  // preview leaves it undefined. These ids are React keys/row ids, not
  // globally unique identifiers, so a per-instance counter is enough.
  const nextRowId = useRef(0);

  async function uploadOne(file: File): Promise<void> {
    const rowId = String(nextRowId.current++);
    setRows((prev) => [...prev, { id: rowId, fileName: file.name, status: "uploading" }]);
    try {
      await onUpload(await resizeImageBeforeUpload(file));
      setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, status: "done" } : row)));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("kumiko.widget.upload.error");
      setRows((prev) =>
        prev.map((row) => (row.id === rowId ? { ...row, status: "error", error: message } : row)),
      );
    }
  }

  async function uploadFiles(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    const picked = multiple ? Array.from(files) : files[0] !== undefined ? [files[0]] : [];
    const [accepted, rejected] = partitionByAccept(picked, accept);
    for (const file of rejected) {
      setRows((prev) => [
        ...prev,
        {
          id: String(nextRowId.current++),
          fileName: file.name,
          status: "error",
          error: t("kumiko.widget.upload.rejected-type"),
        },
      ]);
    }
    await Promise.all(accepted.map((file) => uploadOne(file)));
    // Reset so re-picking the SAME file still fires change — the browser
    // suppresses the event otherwise.
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (disabled === true) return;
    void uploadFiles(e.dataTransfer.files);
  }

  const acceptAttr = toAcceptAttr(accept);

  return (
    <div data-testid={testId} className="flex flex-col gap-4">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (disabled !== true) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
            setDragOver(false);
          }
        }}
        onDrop={handleDrop}
        data-testid={testId !== undefined ? `${testId}-dropzone` : undefined}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
          dragOver ? "border-primary bg-muted/40" : "border-border",
          disabled === true && "cursor-not-allowed opacity-50",
        )}
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm">{title}</span>
        {hint !== undefined && <span className="text-sm text-muted-foreground">{hint}</span>}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          className="sr-only"
          data-testid={testId !== undefined ? `${testId}-input` : undefined}
          disabled={disabled}
          {...(acceptAttr !== undefined && { accept: acceptAttr })}
          onChange={(e) => void uploadFiles(e.target.files)}
        />
      </label>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid={testId !== undefined ? `${testId}-row` : undefined}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm">{row.fileName}</span>
              </div>
              <output className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                {STATUS_ICON[row.status]}
                <span className="sr-only">{t(STATUS_LABEL_KEY[row.status])}</span>
                {row.status === "error" && row.error !== undefined && <span>{row.error}</span>}
              </output>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
