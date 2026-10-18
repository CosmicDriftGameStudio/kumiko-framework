import type { ListColumnFileDisplay } from "@cosmicdrift/kumiko-headless";
import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn.ts";

// Stored values are untrusted: only UUIDs reach a request, and path segments are
// encoded so an id like "../x" or "a?b" cannot redirect the request.
export function fileOriginalUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}`;
}

export function fileVariantUrl(fileId: string, variant: string): string {
  return `${fileOriginalUrl(fileId)}/variant/${encodeURIComponent(variant)}`;
}

function thumbnailSources(fileId: string, variant: string | undefined): readonly string[] {
  if (!isUuid(fileId)) return [];
  return variant === undefined
    ? [fileOriginalUrl(fileId)]
    : [fileVariantUrl(fileId, variant), fileOriginalUrl(fileId)];
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
  const sources = thumbnailSources(fileId, variant);
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
  const validId = isUuid(fileId);
  useEffect(() => {
    let cancelled = false;
    setFileName(null);
    if (!validId) return;
    fetch(`${fileOriginalUrl(fileId)}/meta`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta: unknown) => {
        if (!cancelled && isFileMeta(meta)) setFileName(meta.fileName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId, validId]);
  if (!validId) return <span className={cn("text-sm", className)}>{fallbackLabel}</span>;
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

// Height-bound, width follows the aspect ratio within a clamp, so a portrait and
// a landscape photo both read as a preview without stretching the column.
const TABLE_THUMBNAIL_CLASS = "h-16 min-w-16 max-w-24 object-cover";
// A card's meta line is one text line (h-5) tall.
const CARD_THUMBNAIL_CLASS = "size-5 rounded-sm object-cover";

const CARD_LEADING_CLASS = "size-14 shrink-0 rounded-md object-cover";

// Leading preview of a narrow list card: the card's own image, not a meta chip.
export function CardLeadingImage({
  value,
  display,
}: {
  readonly value: unknown;
  readonly display: ListColumnFileDisplay;
}): ReactNode {
  const [first] = fileIdsOf(value);
  if (first === undefined || display.kind !== "image") return null;
  return (
    <FileThumbnail
      fileId={first}
      className={CARD_LEADING_CLASS}
      {...(display.variant !== undefined && { variant: display.variant })}
    />
  );
}

export function FileDisplayCell({
  value,
  display,
  fallbackLabel,
  compact = false,
}: {
  readonly value: unknown;
  readonly display: ListColumnFileDisplay;
  readonly fallbackLabel: string;
  readonly compact?: boolean;
}): ReactNode {
  const [first, ...rest] = fileIdsOf(value);
  if (first === undefined) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {display.kind === "image" ? (
        <FileThumbnail
          fileId={first}
          className={compact ? CARD_THUMBNAIL_CLASS : TABLE_THUMBNAIL_CLASS}
          {...(display.variant !== undefined && { variant: display.variant })}
        />
      ) : (
        <FileNameLink fileId={first} fallbackLabel={fallbackLabel} />
      )}
      {rest.length > 0 && <span className="text-muted-foreground text-xs">+{rest.length}</span>}
    </span>
  );
}
