import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { CheckCircle2, FileUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { cn } from "../lib/cn";

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
  /** Lädt eine einzelne Datei hoch (POST + ggf. Folge-Mutation). Wirft bei
   *  Fehler — die Message landet in der Fehlerzeile. Läuft parallel pro
   *  Datei eines Batches (kein sequentielles Warten). */
  readonly onUpload: (file: File) => Promise<void>;
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  readonly accept?: readonly string[];
  /** Mehrere Dateien pro Auswahl/Drop erlauben. Default true. */
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
};

// "jpg" → ".jpg", "image/png" bleibt. Leere Liste → kein accept-Attribut.
function toAcceptAttr(accept?: readonly string[]): string | undefined {
  if (accept === undefined || accept.length === 0) return undefined;
  return accept.map((a) => (a.startsWith(".") || a.includes("/") ? a : `.${a}`)).join(",");
}

/** Drop-Zone + Multi-File-Picker mit Status-Zeile pro Datei (uploading/done/
 *  error). Für Screens die mehrere Dateien annehmen und eigenständig
 *  hochladen wollen — anders als `FileField` (Single-File, FileRef-Value in
 *  einem Form-Feld). `onUpload` entscheidet was "hochladen" heißt (Storage-
 *  POST, Ingest-Mutation, beides); die Zone kennt nur uploading/done/error. */
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

  async function uploadOne(file: File): Promise<void> {
    const rowId = crypto.randomUUID();
    setRows((prev) => [...prev, { id: rowId, fileName: file.name, status: "uploading" }]);
    try {
      await onUpload(file);
      setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, status: "done" } : row)));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "upload_failed";
      setRows((prev) =>
        prev.map((row) => (row.id === rowId ? { ...row, status: "error", error: message } : row)),
      );
    }
  }

  async function uploadFiles(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    const picked = multiple ? Array.from(files) : files[0] !== undefined ? [files[0]] : [];
    await Promise.all(picked.map((file) => uploadOne(file)));
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
