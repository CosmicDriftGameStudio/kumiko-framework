import { createHash } from "node:crypto";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";
import { type APIRequestContext, type APIResponse, expect, type Page } from "@playwright/test";
import * as z from "zod";
import type { BoundApi } from "../seed-types";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./constants";

export type LoginCredentials = {
  readonly email: string;
  readonly password: string;
  // Base32 TOTP secret of an enrolled account; answers the MFA challenge after the password step.
  readonly mfaTotpSecret?: string;
};

type ApiEndpoint = "/api/write" | "/api/query" | "/api/command";

type ApiReply = { readonly status: number; readonly body: unknown };

const successEnvelope = z.looseObject({
  isSuccess: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});
const loginReplySchema = z.looseObject({
  mfaRequired: z.boolean().optional(),
  challengeToken: z.string().optional(),
  mfaSetupRequired: z.boolean().optional(),
  preauthSetupToken: z.string().optional(),
  setupToken: z.string().optional(),
  otpauthUri: z.string().optional(),
  totpSecret: z.string().optional(),
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

// Deterministic IP in the RFC 1918 private range, so the same key (a seeded
// user's email, a test's id) always lands in the same rate-limit bucket while
// different keys get distinct buckets (3 varying bytes ~= 16M slots).
export function syntheticClientIpFor(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  return `10.${digest[0]}.${digest[1]}.${digest[2]}`;
}

export const CLIENT_IP_HEADER = "x-forwarded-for";

async function postAuth(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  email: string,
): Promise<APIResponse> {
  const response = await request.post(path, {
    data,
    headers: { [CLIENT_IP_HEADER]: syntheticClientIpFor(email) },
  });
  if (!response.ok()) {
    throw new Error(
      `loginViaApi(${email}): POST ${path} -> ${response.status()} ${await response.text()}`,
    );
  }
  return response;
}

async function postAuthJson(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  email: string,
): Promise<z.infer<typeof loginReplySchema>> {
  return loginReplySchema.parse(await (await postAuth(request, path, data, email)).json());
}

export async function loginViaApi(
  request: APIRequestContext,
  credentials: LoginCredentials,
): Promise<void> {
  const response = await postAuth(
    request,
    "/api/auth/login",
    { email: credentials.email, password: credentials.password },
    credentials.email,
  );
  if (credentials.mfaTotpSecret === undefined) return;
  const reply = loginReplySchema.parse(await response.json());
  if (reply.mfaRequired !== true) return;
  if (reply.challengeToken === undefined) {
    throw new Error(`loginViaApi(${credentials.email}): MFA required but no challengeToken`);
  }
  await postAuth(
    request,
    "/api/auth/mfa/verify",
    {
      challengeToken: reply.challengeToken,
      code: await unburnedTotpCode(credentials.mfaTotpSecret),
    },
    credentials.email,
  );
}

const TOTP_STEP_MS = 30_000;
const lastLoginCounterBySecret = new Map<string, number>();

// The server burns an accepted login code for its whole ±1-step window, so a
// second login within the same step needs the next counter. Only counters up
// to one step ahead are valid; beyond that wait until the clock is in range.
async function unburnedTotpCode(secret: string): Promise<string> {
  const currentCounter = Math.floor(Date.now() / TOTP_STEP_MS);
  const counter = Math.max(currentCounter, (lastLoginCounterBySecret.get(secret) ?? -1) + 1);
  lastLoginCounterBySecret.set(secret, counter);
  const validFromMs = (counter - 1) * TOTP_STEP_MS;
  const waitMs = validFromMs - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  return totpCode(secret, counter * TOTP_STEP_MS);
}

function totpSecretFromOtpauthUri(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (secret === null) throw new Error("otpauth URI carries no secret");
  return secret;
}

/**
 * Enrolls a confirmed TOTP factor through the real auth-mfa endpoints and
 * returns its base32 secret. The context ends up logged in. Works under an
 * MFA-required policy (pre-auth enrollment) and without one (session enrollment).
 */
export async function enrollTotpViaApi(
  request: APIRequestContext,
  credentials: Pick<LoginCredentials, "email" | "password">,
): Promise<string> {
  const reply = await postAuthJson(
    request,
    "/api/auth/login",
    { email: credentials.email, password: credentials.password },
    credentials.email,
  );
  if (reply.mfaRequired === true) {
    throw new Error(`enrollTotpViaApi(${credentials.email}): account already has an MFA factor`);
  }
  if (reply.mfaSetupRequired === true && reply.preauthSetupToken !== undefined) {
    const started = await postAuthJson(
      request,
      "/api/auth/mfa/preauth-enable-start",
      { preauthSetupToken: reply.preauthSetupToken, accountLabel: credentials.email },
      credentials.email,
    );
    if (started.setupToken === undefined || started.otpauthUri === undefined) {
      throw new Error(
        `enrollTotpViaApi(${credentials.email}): preauth-enable-start returned no setup`,
      );
    }
    const secret = totpSecretFromOtpauthUri(started.otpauthUri);
    await postAuthJson(
      request,
      "/api/auth/mfa/preauth-confirm",
      { setupToken: started.setupToken, code: await totpCode(secret) },
      credentials.email,
    );
    return secret;
  }
  const { AuthMfaHandlers } = await import("@cosmicdrift/kumiko-bundled-features/auth-mfa");
  const started = await apiWrite<{ setupToken: string; totpSecret: string }>(
    request,
    AuthMfaHandlers.enableStart,
    {},
  );
  await apiWrite(request, AuthMfaHandlers.enableConfirm, {
    setupToken: started.setupToken,
    code: await totpCode(started.totpSecret),
  });
  return started.totpSecret;
}

// Leaves the app page first: an app page still open while its cookies vanish redirects itself
// to /login?next=… on its next request, racing whatever the test navigates to next.
export async function clearSession(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.context().clearCookies();
}

export async function loginViaUi(page: Page, credentials: LoginCredentials): Promise<void> {
  // seedTenant already logged the context in, and an authenticated session never renders /login.
  await clearSession(page);
  await page.goto("/login");
  await page.locator("#login-email").fill(credentials.email);
  await page.locator("#login-password").fill(credentials.password);
  await page.locator("#login-password").press("Enter");
  await expect(page.locator("#login-password")).toHaveCount(0);
  if (credentials.mfaTotpSecret === undefined) return;
  // A secret means an enrolled factor, so the MFA step must come; waiting for it
  // avoids racing the transition from the password form.
  const codeField = page.locator("#mfa-verify-code");
  await expect(codeField).toBeVisible();
  await codeField.fill(await unburnedTotpCode(credentials.mfaTotpSecret));
  await codeField.press("Enter");
  await expect(codeField).toHaveCount(0);
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
