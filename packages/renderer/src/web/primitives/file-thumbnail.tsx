import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { fileIdsOf } from "../../file-ids-of.ts";
import type { ListColumnFileDisplay } from "../../headless/index.ts";
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
      loading="lazy"
      decoding="async"
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

type FileMeta = { readonly fileName: string; readonly mimeType: string | undefined };

function parseFileMeta(value: unknown): FileMeta | null {
  if (typeof value !== "object" || value === null || !("fileName" in value)) return null;
  if (typeof value.fileName !== "string") return null;
  const mimeType =
    "mimeType" in value && typeof value.mimeType === "string" ? value.mimeType : undefined;
  return { fileName: value.fileName, mimeType };
}

const META_BATCH_SIZE = 100;
const META_CACHE_LIMIT = 500;

const metaCache = new Map<string, Promise<FileMeta | null>>();
let pendingMetaIds = new Map<string, (meta: FileMeta | null) => void>();

/** File names are per-user data and the server re-checks access per request, so
 *  the cache must not outlive the session that filled it. */
export function clearFileMetaCache(): void {
  metaCache.clear();
}

function parseBatchMeta(json: unknown): ReadonlyMap<string, FileMeta> {
  const metaById = new Map<string, FileMeta>();
  if (typeof json !== "object" || json === null || !("files" in json)) return metaById;
  if (!Array.isArray(json.files)) return metaById;
  for (const file of json.files) {
    const meta = parseFileMeta(file);
    if (meta !== null && typeof file === "object" && file !== null && "id" in file) {
      if (typeof file.id === "string") metaById.set(file.id, meta);
    }
  }
  return metaById;
}

async function fetchMetaBatch(
  ids: readonly string[],
  resolvers: ReadonlyMap<string, (meta: FileMeta | null) => void>,
): Promise<void> {
  let metaById: ReadonlyMap<string, FileMeta> | null = null;
  try {
    const res = await fetch(`/api/files/meta?ids=${ids.map(encodeURIComponent).join(",")}`);
    if (res.ok) metaById = parseBatchMeta(await res.json());
  } catch {
    // skip: a failed lookup shows the fallback label, like a missing file
  }
  for (const id of ids) {
    // A transport failure must not stick in the cache; an id the server left out is a final answer.
    if (metaById === null) metaCache.delete(id);
    resolvers.get(id)?.(metaById?.get(id) ?? null);
  }
}

function flushPendingMetaIds(): void {
  const batch = pendingMetaIds;
  pendingMetaIds = new Map();
  const ids = [...batch.keys()];
  for (let start = 0; start < ids.length; start += META_BATCH_SIZE) {
    void fetchMetaBatch(ids.slice(start, start + META_BATCH_SIZE), batch);
  }
}

function loadFileMeta(fileId: string): Promise<FileMeta | null> {
  const cached = metaCache.get(fileId);
  if (cached) return cached;
  const promise = new Promise<FileMeta | null>((resolve) => {
    if (pendingMetaIds.size === 0) queueMicrotask(flushPendingMetaIds);
    pendingMetaIds.set(fileId, resolve);
  });
  if (metaCache.size >= META_CACHE_LIMIT) {
    // An id still waiting for its batch keeps its entry, or its promise would never settle.
    for (const key of metaCache.keys()) {
      if (pendingMetaIds.has(key)) continue;
      metaCache.delete(key);
      break;
    }
  }
  metaCache.set(fileId, promise);
  return promise;
}

export function useFileMeta(fileId: string): FileMeta | null {
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const validId = isUuid(fileId);
  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    if (!validId) return;
    void loadFileMeta(fileId).then((loaded) => {
      if (!cancelled) setMeta(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, validId]);
  return meta;
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
  const fileName = useFileMeta(fileId)?.fileName ?? null;
  if (!isUuid(fileId)) return <span className={cn("text-sm", className)}>{fallbackLabel}</span>;
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
