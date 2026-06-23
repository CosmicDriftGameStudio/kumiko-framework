import { type CachePolicy, cachedResponse } from "@cosmicdrift/kumiko-framework/api";
import { securePageHeaders } from "./security-headers";

export type CachedSecurePageResponseInit = {
  readonly body: BodyInit | null;
  readonly status?: number;
  readonly etag: string;
  readonly cache: CachePolicy;
  readonly extra?: Record<string, string>;
  readonly lastModified?: Date;
};

export function cachedSecurePageResponse(
  req: Request,
  init: CachedSecurePageResponseInit,
): Response {
  return cachedResponse(req, {
    body: init.body,
    status: init.status,
    etag: init.etag,
    cache: init.cache,
    lastModified: init.lastModified,
    headers: securePageHeaders(init.extra ?? {}),
  });
}
