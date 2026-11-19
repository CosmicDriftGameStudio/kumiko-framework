import type { ContentfulStatusCode } from "hono/utils/http-status";

const CONTENTLESS_STATUS_CODES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function isContentfulStatusCode(status: number): status is ContentfulStatusCode {
  return (
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599 &&
    !CONTENTLESS_STATUS_CODES.has(status)
  );
}

export function toContentfulStatus(status: number): ContentfulStatusCode {
  return isContentfulStatusCode(status) ? status : 500;
}
