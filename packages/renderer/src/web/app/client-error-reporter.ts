import { createErrorId } from "../../components/error-id.ts";
import { CSRF_HEADER_NAME, readCsrfToken } from "../../live/csrf.ts";

export const CLIENT_ERRORS_PATH = "/api/client-errors";
export const MAX_CLIENT_ERROR_REPORTS = 5;

// Mirrors the server's strict schema; longer values would get the whole report rejected.
const LIMITS = { message: 500, stack: 4000, screen: 200, path: 300 } as const;

export type ClientErrorKind = "render" | "unhandled";

export type ClientErrorReport = {
  readonly errorId?: string;
  readonly kind: ClientErrorKind;
  readonly error: unknown;
  readonly screen?: string;
};

export type ClientErrorReporter = {
  readonly report: (report: ClientErrorReport) => void;
  /** Starts forwarding window error/unhandledrejection events; returns the stop function. */
  readonly installGlobalHandlers: () => () => void;
};

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

// One handler pair per page: a repeated createKumikoApp (HMR, tests) must replace, not stack, the listeners.
let removeActiveGlobalHandlers: (() => void) | undefined;

export function createClientErrorReporter(): ClientErrorReporter {
  const seenMessages = new Set<string>();

  function send(body: Record<string, unknown>): void {
    // skip: no fetch (native shell without polyfill) means nowhere to report to
    if (typeof fetch !== "function") return;
    const csrf = readCsrfToken();
    try {
      void fetch(CLIENT_ERRORS_PATH, {
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrf !== undefined && { [CSRF_HEADER_NAME]: csrf }),
        },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    } catch {
      // Reporting must never throw into the error path it observes.
    }
  }

  function report({ errorId, kind, error, screen }: ClientErrorReport): void {
    // skip: per-page cap keeps an error loop from flooding the endpoint
    if (seenMessages.size >= MAX_CLIENT_ERROR_REPORTS) return;
    const { message, stack } = toError(error);
    // skip: duplicate of an already reported message
    if (seenMessages.has(message)) return;
    seenMessages.add(message);
    const path = typeof location === "undefined" ? undefined : location.pathname;
    send({
      errorId: errorId ?? createErrorId(),
      kind,
      message: clip(message, LIMITS.message),
      ...(stack !== undefined && stack !== "" && { stack: clip(stack, LIMITS.stack) }),
      ...(screen !== undefined && { screen: clip(screen, LIMITS.screen) }),
      ...(path !== undefined && { path: clip(path, LIMITS.path) }),
    });
  }

  function installGlobalHandlers(): () => void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return () => undefined;
    }
    const onError = (event: ErrorEvent): void => {
      // skip: resource-load failures arrive as plain Events without an error payload
      if (event.error === undefined && !event.message) return;
      report({ kind: "unhandled", error: event.error ?? new Error(event.message) });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      report({ kind: "unhandled", error: event.reason });
    };
    removeActiveGlobalHandlers?.();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const remove = (): void => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (removeActiveGlobalHandlers === remove) removeActiveGlobalHandlers = undefined;
    };
    removeActiveGlobalHandlers = remove;
    return remove;
  }

  return { report, installGlobalHandlers };
}
