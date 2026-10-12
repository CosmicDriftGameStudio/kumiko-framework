import type { ListColumnFileDisplay } from "@cosmicdrift/kumiko-headless";
import { ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn.js";

export function fileOriginalUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

function fileVariantUrl(fileId: string, variant: string): string {
  return `/api/files/${fileId}/variant/${variant}`;
}

// A declared variant can 404 when the upload carried no entityType/fieldName
// (the variant is resolved per field), while the original always serves. So the
// chain is variant -> original -> placeholder instead of a broken-image icon.
function ThumbnailChain({
  fileId,
  variant,
  className,
  testId,
}: {
  readonly fileId: string;
  readonly variant: string | undefined;
  readonly className: string;
  readonly testId: string | undefined;
}): ReactNode {
  const sources =
    variant === undefined
      ? [fileOriginalUrl(fileId)]
      : [fileVariantUrl(fileId, variant), fileOriginalUrl(fileId)];
  const [failedCount, setFailedCount] = useState(0);
  const src = sources[failedCount];
  if (src === undefined) {
    return (
      <div
        data-testid={testId}
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center rounded-md border",
          className,
        )}
      >
        <ImageIcon className="size-1/3" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      data-testid={testId}
      onError={() => setFailedCount((n) => n + 1)}
      className={cn("bg-muted rounded-md border object-contain", className)}
    />
  );
}

export function FileThumbnail({
  fileId,
  variant,
  className = "h-24 w-32",
  testId,
}: {
  readonly fileId: string;
  readonly variant?: string;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  return (
    <ThumbnailChain
      key={`${fileId}:${variant ?? ""}`}
      fileId={fileId}
      variant={variant}
      className={className}
      testId={testId}
    />
  );
}

function isFileMeta(value: unknown): value is { readonly fileName: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "fileName" in value &&
    typeof value.fileName === "string"
  );
}

export function FileNameLink({
  fileId,
  fallbackLabel,
  className,
}: {
  readonly fileId: string;
  readonly fallbackLabel: string;
  readonly className?: string;
}): ReactNode {
  const [fileName, setFileName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFileName(null);
    fetch(`${fileOriginalUrl(fileId)}/meta`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta: unknown) => {
        if (!cancelled && isFileMeta(meta)) setFileName(meta.fileName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return (
    <a
      href={fileOriginalUrl(fileId)}
      target="_blank"
      rel="noreferrer"
      className={cn("text-sm underline underline-offset-2", className)}
    >
      {fileName ?? fallbackLabel}
    </a>
  );
}

function fileIdsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return value === "" ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

export function FileDisplayCell({
  value,
  display,
  fallbackLabel,
}: {
  readonly value: unknown;
  readonly display: ListColumnFileDisplay;
  readonly fallbackLabel: string;
}): ReactNode {
  const [first, ...rest] = fileIdsOf(value);
  if (first === undefined) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {display.kind === "image" ? (
        <FileThumbnail
          fileId={first}
          className="size-10"
          {...(display.variant !== undefined && { variant: display.variant })}
        />
      ) : (
        <FileNameLink fileId={first} fallbackLabel={fallbackLabel} />
      )}
      {rest.length > 0 && <span className="text-muted-foreground text-xs">+{rest.length}</span>}
    </span>
  );
}
