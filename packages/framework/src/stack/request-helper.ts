import type { Hono } from "hono";
import type { JwtHelper } from "../api/jwt";
import type { SessionUser } from "../engine/types";

export type BatchCommand = { type: string; payload: unknown };

type WireErrorBody = {
  readonly code?: string;
  readonly details?: {
    readonly causeName?: string;
    readonly causeMessage?: string;
    readonly causeStack?: string;
  };
};

function formatWriteFailure(type: string, body: unknown): string {
  const parsed = body as {
    isSuccess?: boolean;
    error?: WireErrorBody | string;
  };
  const code =
    (typeof parsed.error === "object" ? parsed.error?.code : undefined) ??
    (typeof parsed.error === "string" ? parsed.error : "unknown");
  const details =
    typeof parsed.error === "object" && parsed.error?.details !== undefined
      ? parsed.error.details
      : undefined;
  const causeMessage =
    details && typeof details === "object" && "causeMessage" in details
      ? String((details as { causeMessage?: unknown }).causeMessage ?? "")
      : "";
  const causeName =
    details && typeof details === "object" && "causeName" in details
      ? String((details as { causeName?: unknown }).causeName ?? "")
      : "";
  if (code === "internal_error" && (causeMessage || causeName)) {
    return `Expected write "${type}" to succeed but got error: ${code} (${causeName}: ${causeMessage})`;
  }
  if (details !== undefined) {
    return `Expected write "${type}" to succeed but got error: ${code} — ${JSON.stringify(details)}`;
  }
  return `Expected write "${type}" to succeed but got error: ${code}`;
}

export type RequestHelper = {
  write: (
    type: string,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ) => Promise<Response>;
  query: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
  command: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
  batch: (
    commands: readonly BatchCommand[],
    user: SessionUser,
    requestId?: string,
  ) => Promise<Response>;
  raw: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;

  /** write + json + assert isSuccess — returns data directly */
  writeOk: <T = Record<string, unknown>>(
    type: string,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ) => Promise<T>;
  /** write + json + assert isSuccess === false — returns the structured
   *  WriteErrorInfo with `httpStatus` filled in from the HTTP response. */
  writeErr: (
    type: string,
    payload: unknown,
    user: SessionUser,
  ) => Promise<import("../errors").WriteErrorInfo>;
  /** query + json — returns data directly */
  queryOk: <T = unknown>(type: string, payload: unknown, user: SessionUser) => Promise<T>;

  /** write + additional HTTP headers (e.g. X-Correlation-ID). Returns the
   *  raw Response so callers can assert on status + headers + body as needed. */
  writeWithHeaders: (
    type: string,
    payload: unknown,
    user: SessionUser,
    extraHeaders: Record<string, string>,
  ) => Promise<Response>;
  /** query + additional HTTP headers (e.g. X-Forwarded-For). Returns the raw
   *  Response so callers can assert on status + headers + body as needed. */
  queryWithHeaders: (
    type: string,
    payload: unknown,
    user: SessionUser,
    extraHeaders: Record<string, string>,
  ) => Promise<Response>;
};

export function createRequestHelper(app: Hono, jwt: JwtHelper): RequestHelper {
  async function authHeader(user: SessionUser): Promise<Record<string, string>> {
    const token = await jwt.sign(user);
    return { Authorization: `Bearer ${token}` };
  }

  async function req(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    if (body) init.body = JSON.stringify(body);
    return app.request(path, init);
  }

  async function writeRaw(
    type: string,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<Response> {
    const headers = await authHeader(user);
    return req("POST", "/api/write", { type, payload, requestId }, headers);
  }

  async function queryRaw(type: string, payload: unknown, user: SessionUser): Promise<Response> {
    const headers = await authHeader(user);
    return req("POST", "/api/query", { type, payload }, headers);
  }

  return {
    write: writeRaw,
    query: queryRaw,

    async command(type, payload, user) {
      const headers = await authHeader(user);
      return req("POST", "/api/command", { type, payload }, headers);
    },

    async batch(commands, user, requestId) {
      const headers = await authHeader(user);
      return req("POST", "/api/batch", { commands, requestId }, headers);
    },

    raw: req,

    async writeOk<T = Record<string, unknown>>(
      type: string,
      payload: unknown,
      user: SessionUser,
      requestId?: string,
    ): Promise<T> {
      const res = await writeRaw(type, payload, user, requestId);
      // wire-body shape direkt nach JSON.parse — Caller-Code prüft danach
      // selber ob isSuccess/error/data tatsächlich da sind.
      const rawBody = await res.json();
      const body = rawBody as {
        // @cast-boundary engine-bridge
        isSuccess?: boolean;
        data?: unknown;
        error?: { code?: string } | string;
      };
      // Success path still has { isSuccess: true, data }. Error responses now
      // follow the error-contract shape { error: { code, i18nKey, ... } } with
      // a 4xx/5xx status — no isSuccess flag. Detect either.
      if (body.isSuccess !== true) {
        throw new Error(formatWriteFailure(type, body));
      }
      return body.data as T; // @cast-boundary engine-bridge
    },

    async writeErr(
      type: string,
      payload: unknown,
      user: SessionUser,
    ): Promise<import("../errors").WriteErrorInfo> {
      const res = await writeRaw(type, payload, user);
      const rawErrorBody = await res.json();
      const body = rawErrorBody as {
        // @cast-boundary engine-bridge
        isSuccess?: boolean;
        error?: Omit<import("../errors").WriteErrorInfo, "httpStatus">;
      };
      if (body.isSuccess === true) {
        throw new Error(`Expected write "${type}" to fail but it succeeded`);
      }
      const wire = body.error;
      if (!wire || typeof wire !== "object" || typeof wire.code !== "string") {
        throw new Error(
          `Expected error response for "${type}" but got unexpected shape: ${JSON.stringify(body)}`,
        );
      }
      // The wire body doesn't carry httpStatus (it would be redundant with
      // the HTTP response status). Fill it in from res.status so callers can
      // assert against either code OR status without a second request round.
      return { ...wire, httpStatus: res.status };
    },

    async queryOk<T = unknown>(type: string, payload: unknown, user: SessionUser): Promise<T> {
      const res = await queryRaw(type, payload, user);
      const body = (await res.json()) as { data: unknown }; // @cast-boundary engine-bridge
      return body.data as T; // @cast-boundary engine-bridge
    },

    async writeWithHeaders(type, payload, user, extraHeaders) {
      const authHeaders = await authHeader(user);
      return req("POST", "/api/write", { type, payload }, { ...authHeaders, ...extraHeaders });
    },

    async queryWithHeaders(type, payload, user, extraHeaders) {
      const authHeaders = await authHeader(user);
      return req("POST", "/api/query", { type, payload }, { ...authHeaders, ...extraHeaders });
    },
  };
}
