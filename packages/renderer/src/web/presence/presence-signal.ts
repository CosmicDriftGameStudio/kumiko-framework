import type { DispatcherError } from "../../headless/index.ts";

type PresenceSignal = { readonly entity: string; readonly id?: string };

// The live frame is addressed to one user and carries no row data, only which room changed.
// Narrowed from `unknown` because the shared LiveEvent type describes entity frames.
export function isPresenceSignalFor(data: unknown, entity: string, id?: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  const signal: Partial<PresenceSignal> = data;
  if (signal.entity !== entity) return false;
  return id === undefined || signal.id === id;
}

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

// A 4xx (feature not mounted, entity not allowed, row not visible, role denied) will not
// change by asking again, so presence goes quiet instead of retrying forever.
export function isPermanentPresenceFailure(error: DispatcherError): boolean {
  return (
    error.httpStatus >= 400 &&
    error.httpStatus < 500 &&
    error.httpStatus !== HTTP_REQUEST_TIMEOUT &&
    error.httpStatus !== HTTP_TOO_MANY_REQUESTS
  );
}
