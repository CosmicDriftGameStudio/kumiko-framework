import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";
import { type APIRequestContext, type APIResponse, expect, type Page } from "@playwright/test";
import { z } from "zod";
import type { BoundApi } from "../seed-types";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./constants";

export type LoginCredentials = { readonly email: string; readonly password: string };

type ApiEndpoint = "/api/write" | "/api/query" | "/api/command";

type ApiReply = { readonly status: number; readonly body: unknown };

const successEnvelope = z.looseObject({
  isSuccess: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});
const errorEnvelope = z.looseObject({ error: z.looseObject({ code: z.string() }) });

export function csrfHeaderFromCookies(
  cookies: readonly { readonly name: string; readonly value: string }[],
): Record<string, string> {
  const token = cookies.find((cookie) => cookie.name === CSRF_COOKIE_NAME)?.value;
  return token === undefined ? {} : { [CSRF_HEADER_NAME]: token };
}

export async function csrfFetch(
  request: APIRequestContext,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  const { cookies } = await request.storageState();
  return request.post(path, { headers: csrfHeaderFromCookies(cookies), data });
}

export async function loginViaApi(
  request: APIRequestContext,
  credentials: LoginCredentials,
): Promise<void> {
  const response = await request.post("/api/auth/login", {
    data: { email: credentials.email, password: credentials.password },
  });
  if (!response.ok()) {
    throw new Error(
      `loginViaApi(${credentials.email}): POST /api/auth/login -> ${response.status()} ${await response.text()}`,
    );
  }
}

export async function loginViaUi(page: Page, credentials: LoginCredentials): Promise<void> {
  // seedTenant already logged the context in, and an authenticated session never renders /login.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#login-email").fill(credentials.email);
  await page.locator("#login-password").fill(credentials.password);
  await page.locator("#login-password").press("Enter");
  await expect(page.locator("#login-password")).toHaveCount(0);
}

async function postApi(
  request: APIRequestContext,
  endpoint: ApiEndpoint,
  body: Record<string, unknown>,
): Promise<ApiReply> {
  const response = await csrfFetch(request, endpoint, body);
  const text = await response.text();
  try {
    return { status: response.status(), body: JSON.parse(text) };
  } catch {
    return { status: response.status(), body: text };
  }
}

function describeReply(reply: ApiReply): string {
  return `HTTP ${reply.status} ${JSON.stringify(reply.body)}`;
}

function successData(kind: string, type: string, reply: ApiReply): unknown {
  const parsed = successEnvelope.safeParse(reply.body);
  const succeeded =
    reply.status >= 200 &&
    reply.status < 300 &&
    parsed.success &&
    parsed.data.isSuccess !== false &&
    parsed.data.error === undefined;
  if (!succeeded) {
    throw new Error(`Expected ${kind} "${type}" to succeed but got ${describeReply(reply)}`);
  }
  return parsed.data.data;
}

function failureInfo(kind: string, type: string, reply: ApiReply): WriteErrorInfo {
  const parsed = errorEnvelope.safeParse(reply.body);
  if (reply.status < 400 || !parsed.success) {
    throw new Error(`Expected ${kind} "${type}" to fail but got ${describeReply(reply)}`);
  }
  // @cast-boundary engine-payload — the wire error envelope is WriteErrorInfo minus httpStatus
  return { ...(parsed.data.error as Omit<WriteErrorInfo, "httpStatus">), httpStatus: reply.status };
}

export async function apiWrite<T = Record<string, unknown>>(
  request: APIRequestContext,
  type: string,
  payload: unknown,
  requestId?: string,
): Promise<T> {
  const reply = await postApi(request, "/api/write", { type, payload, requestId });
  return successData("write", type, reply) as T; // @cast-boundary engine-payload
}

export async function apiQuery<T = unknown>(
  request: APIRequestContext,
  type: string,
  payload: unknown = {},
): Promise<T> {
  const reply = await postApi(request, "/api/query", { type, payload });
  return successData("query", type, reply) as T; // @cast-boundary engine-payload
}

export async function apiCommand(
  request: APIRequestContext,
  type: string,
  payload: unknown,
): Promise<void> {
  const reply = await postApi(request, "/api/command", { type, payload });
  if (reply.status !== 202) {
    throw new Error(
      `Expected command "${type}" to be accepted (202) but got ${describeReply(reply)}`,
    );
  }
}

export function createHttpApi(request: APIRequestContext): BoundApi {
  return {
    writeOk: (type, payload, requestId) => apiWrite(request, type, payload, requestId),
    writeErr: async (type, payload) =>
      failureInfo("write", type, await postApi(request, "/api/write", { type, payload })),
    queryOk: (type, payload) => apiQuery(request, type, payload),
    queryErr: async (type, payload) =>
      failureInfo("query", type, await postApi(request, "/api/query", { type, payload })),
  };
}

export async function totpCode(secret: Buffer | string, nowMs?: number): Promise<string> {
  const key =
    typeof secret === "string"
      ? (await import("@cosmicdrift/kumiko-bundled-features/auth-mfa")).base32Decode(secret)
      : secret;
  return currentTotpCode(key, nowMs);
}
