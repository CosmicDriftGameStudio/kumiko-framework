import { createHash } from "node:crypto";

export type CachePolicy =
  | { readonly kind: "immutable"; readonly maxAgeSeconds?: number }
  | { readonly kind: "revalidate"; readonly maxAgeSeconds?: number }
  | { readonly kind: "no-cache" }
  | { readonly kind: "none" };

export type CachedResponseInit = {
  readonly body: BodyInit | null;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly etag: string;
  readonly cache: CachePolicy;
  readonly lastModified?: Date;
};

const DEFAULT_IMMUTABLE_MAX_AGE = 31_536_000;
const DEFAULT_REVALIDATE_MAX_AGE = 0;

function digestEtag(seed: string | Uint8Array): string {
  const hash = createHash("sha256").update(seed).digest("base64url").slice(0, 22);
  return `"${hash}"`;
}

/** Weak ETag for disk files — cheap, good enough for static assets. */
export function computeWeakEtag(mtimeMs: number, size: number): string {
  return `W/"${mtimeMs}-${size}"`;
}

/** Strong ETag from final response bytes (e.g. index.html after schema inject). */
export function computeStrongEtag(seed: string | Uint8Array): string {
  return digestEtag(seed);
}

/** Strong ETag from revision parts — avoids rendering before a 304 check. */
export function computeRevisionEtag(parts: readonly string[]): string {
  return digestEtag(parts.join("\0"));
}

export function cacheControlHeader(policy: CachePolicy): string | undefined {
  switch (policy.kind) {
    case "immutable":
      return `public, max-age=${policy.maxAgeSeconds ?? DEFAULT_IMMUTABLE_MAX_AGE}, immutable`;
    case "revalidate": {
      const maxAge = policy.maxAgeSeconds ?? DEFAULT_REVALIDATE_MAX_AGE;
      return `public, max-age=${maxAge}, must-revalidate`;
    }
    case "no-cache":
      return "no-cache";
    case "none":
      return undefined;
  }
}

function normalizeEtag(value: string): string {
  return value.trim();
}

function weakEtagMatches(stored: string, candidate: string): boolean {
  const storedNorm = normalizeEtag(stored);
  const candidateNorm = normalizeEtag(candidate);
  if (storedNorm === candidateNorm) return true;
  const storedWeak = storedNorm.startsWith("W/") ? storedNorm.slice(2) : storedNorm;
  const candidateWeak = candidateNorm.startsWith("W/") ? candidateNorm.slice(2) : candidateNorm;
  return storedWeak === candidateWeak;
}

/** Parse `If-None-Match` into individual tag values (order preserved). */
export function parseIfNoneMatch(header: string | null): readonly string[] {
  if (header === null || header.trim() === "") return [];
  if (header.trim() === "*") return ["*"];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);
  if (tags.length === 0) return false;
  if (tags.includes("*")) return true;
  return tags.some((tag) => weakEtagMatches(etag, tag));
}

function isNotModifiedSince(ifModifiedSince: string, lastModified: Date): boolean {
  const parsed = Date.parse(ifModifiedSince);
  if (Number.isNaN(parsed)) return false;
  // HTTP dates have second precision — floor the stored mtime.
  return Math.floor(lastModified.getTime() / 1000) * 1000 <= parsed;
}

function buildResponseHeaders(init: CachedResponseInit): Record<string, string> {
  const headers: Record<string, string> = { ...(init.headers ?? {}), etag: init.etag };
  const cacheControl = cacheControlHeader(init.cache);
  if (cacheControl !== undefined) headers["cache-control"] = cacheControl;
  if (init.lastModified !== undefined) {
    headers["last-modified"] = init.lastModified.toUTCString();
  }
  return headers;
}

/** Conditional GET/HEAD helper — returns 304 when the client already has the revision. */
export function cachedResponse(req: Request, init: CachedResponseInit): Response {
  const headers = buildResponseHeaders(init);
  const ifNoneMatch = req.headers.get("if-none-match");
  if (etagMatches(ifNoneMatch, init.etag)) {
    return new Response(null, { status: 304, headers });
  }
  if (init.lastModified !== undefined) {
    const ifModifiedSince = req.headers.get("if-modified-since");
    if (ifModifiedSince !== null && isNotModifiedSince(ifModifiedSince, init.lastModified)) {
      return new Response(null, { status: 304, headers });
    }
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: init.status ?? 200, headers });
  }
  return new Response(init.body, { status: init.status ?? 200, headers });
}
