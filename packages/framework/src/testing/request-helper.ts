import type { Hono } from "hono";
import type { SessionUser } from "../engine/types";
import type { JwtHelper } from "../api/jwt";

export type RequestHelper = {
  write: (type: string, payload: unknown, user: SessionUser, requestId?: string) => Promise<Response>;
  query: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
  command: (type: string, payload: unknown, user: SessionUser) => Promise<Response>;
  raw: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
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

  return {
    async write(type, payload, user, requestId?) {
      const headers = await authHeader(user);
      return req("POST", "/api/write", { type, payload, requestId }, headers);
    },
    async query(type, payload, user) {
      const headers = await authHeader(user);
      return req("POST", "/api/query", { type, payload }, headers);
    },
    async command(type, payload, user) {
      const headers = await authHeader(user);
      return req("POST", "/api/command", { type, payload }, headers);
    },
    raw: req,
  };
}
