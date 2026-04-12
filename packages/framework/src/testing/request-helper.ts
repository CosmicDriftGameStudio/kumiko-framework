import type { Hono } from "hono";
import type { JwtHelper } from "../api/jwt";
import type { SessionUser } from "../engine/types";

export type RequestHelper = {
  write: (
    type: string,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ) => Promise<Response>;
  query: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
  command: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
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
  /** write + json + assert isSuccess === false — returns error string */
  writeErr: (
    type: string,
    payload: unknown,
    user: SessionUser,
  ) => Promise<string>;
  /** query + json — returns data directly */
  queryOk: <T = unknown>(
    type: string,
    payload: unknown,
    user: SessionUser,
  ) => Promise<T>;
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

    async query(type, payload, user) {
      return queryRaw(type, payload, user);
    },

    async command(type, payload, user) {
      const headers = await authHeader(user);
      return req("POST", "/api/command", { type, payload }, headers);
    },

    raw: req,

    async writeOk<T = Record<string, unknown>>(
      type: string,
      payload: unknown,
      user: SessionUser,
      requestId?: string,
    ): Promise<T> {
      const res = await writeRaw(type, payload, user, requestId);
      const body = await res.json();
      if (!body.isSuccess) {
        throw new Error(`Expected write "${type}" to succeed but got error: ${body.error}`);
      }
      return body.data as T;
    },

    async writeErr(type: string, payload: unknown, user: SessionUser): Promise<string> {
      const res = await writeRaw(type, payload, user);
      const body = await res.json();
      if (body.isSuccess) {
        throw new Error(`Expected write "${type}" to fail but it succeeded`);
      }
      return body.error as string;
    },

    async queryOk<T = unknown>(type: string, payload: unknown, user: SessionUser): Promise<T> {
      const res = await queryRaw(type, payload, user);
      const body = await res.json();
      return body.data as T;
    },
  };
}
