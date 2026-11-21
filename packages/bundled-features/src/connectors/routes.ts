import { createHash } from "node:crypto";
import {
  binaryBodySignatureRoute,
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  publicOriginOf,
  type SignatureExtraRouteDeps,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import { parseTenantId, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { FrameworkReasons, VERSION_CONFLICT_CODE } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Context } from "hono";
import * as z from "zod";
import { pairingAddressKey } from "./address-key.ts";
import { inboundItemAggregateId } from "./aggregate-id.ts";
import {
  CONNECTOR_CLIENT_ID,
  CONNECTOR_ROUTE_PATHS,
  ConnectorErrors,
  ConnectorHandlers,
  ConnectorQueries,
  ConnectorScreens,
  DEFAULT_CONNECTORS_BASE_PATH,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEVICE_CODE_GRANT_TYPE,
  HEARTBEAT_MAX_BODY_BYTES,
  HEARTBEAT_RATE_LIMIT,
  PAIRING_FLOOD_RETRY_AFTER_SECONDS,
  PAIRING_STARTS_PER_MINUTE,
  UPLOAD_RATE_LIMIT,
} from "./constants.ts";
import {
  type AuthenticatedDevice,
  authenticateDevice,
  bearerTokenOf,
  normalizeRelativePath,
} from "./device-auth.ts";
import { syncReportSchema, type uploadOutcomeSchema } from "./handlers/touch-device.write.ts";
import { exceedsFolderLimits, isBallastPath } from "./path-rules.ts";

export type ConnectorRouteOptions = {
  /** Mount point of the satellite endpoints. Default "/connectors". Must not be under "/api/". */
  readonly basePath?: string;
  /** Per-file cap in bytes. Default 50 MiB. */
  readonly maxUploadBytes?: number;
  /** Absolute URL of the page where a TenantAdmin confirms the user code; shown to the satellite.
   *  Default: the public app URL (APP_BASE_URL), else the address the satellite reached the app on,
   *  plus "/connector-pair" (the pairing screen's URL without a base path; set this option behind one). */
  readonly verificationUri?: string;
  /** Flood protection of the pairing start (client_id is public). Defaults: 10 starts per minute and
   *  address, 3 open requests per address, 1000 open requests overall. */
  readonly pairingLimits?: {
    readonly startsPerMinute?: number;
    readonly maxOpenPerIp?: number;
    readonly maxOpenTotal?: number;
  };
};

const NO_STORE = { "Cache-Control": "no-store" } as const;
const FORM_RATE_LIMIT_WINDOW_SECONDS = 60;
// `sync` is optional so satellites that predate the status log keep working. A `lastError` text they
// send is dropped by the parse on purpose (see the device schema).
const HEARTBEAT_SCHEMA = z.object({
  version: z.string().min(1).max(64),
  sync: syncReportSchema.optional(),
});
const connectorNameSchema = z.object({ name: z.string() }).nullable();
const touchResultSchema = z.object({ retry: z.boolean() });
const tooManyOpenSchema = z.object({ tooManyOpenRequests: z.literal(true) });
const receivedSchema = z.object({ id: z.uuid(), duplicate: z.boolean() });
const pollOutcomeSchema = z.object({
  kind: z.enum(["token", "authorization_pending", "slow_down", "expired_token", "invalid_grant"]),
  accessToken: z.string().optional(),
});
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// What x/oauth2 and every RFC 8628 client expect: HTTP 400 with `{error}` for protocol errors.
function oauthError(c: Context, error: string): Response {
  return c.json({ error }, 400, NO_STORE);
}

function clientIdOf(
  form: URLSearchParams,
  headers: Readonly<Record<string, string>>,
): string | null {
  const fromForm = form.get("client_id");
  if (fromForm !== null) return fromForm;
  const basic = /^Basic (\S+)$/.exec(headers["authorization"] ?? "")?.[1];
  if (basic === undefined) return null;
  const [id] = Buffer.from(basic, "base64").toString("utf8").split(":");
  if (id === undefined) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

function parseClientForm(
  rawBody: string,
  headers: Readonly<Record<string, string>>,
): URLSearchParams {
  const form = new URLSearchParams(rawBody);
  if (clientIdOf(form, headers) !== CONNECTOR_CLIENT_ID) {
    throw new ExtraRouteRejection(401, { error: "invalid_client" });
  }
  return form;
}

function verifyBearerFormat(headers: Readonly<Record<string, string>>): Record<string, never> {
  if (bearerTokenOf(headers["authorization"]) === null)
    throw new ExtraRouteRejection(401, { error: "invalid_token" });
  return {};
}

function unauthorized(c: Context): Response {
  return c.json({ error: "invalid_token" }, 401, { "WWW-Authenticate": "Bearer" });
}

function failureReason(error: { readonly details?: unknown }): string | undefined {
  const details = error.details;
  if (typeof details !== "object" || details === null || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

async function touchDevice(
  deps: SignatureExtraRouteDeps,
  device: AuthenticatedDevice,
  heartbeat?: { readonly version: string; readonly sync?: z.infer<typeof syncReportSchema> },
  upload?: z.infer<typeof uploadOutcomeSchema>,
): Promise<boolean> {
  const result = await deps.dispatchWriteAs({
    handlerQn: ConnectorHandlers.touchDevice,
    payload: {
      deviceId: device.deviceId,
      ...(upload !== undefined && { upload }),
      ...(heartbeat && {
        reportedVersion: heartbeat.version,
        ...(heartbeat.sync && { sync: heartbeat.sync }),
        consumeRetry: true,
      }),
    },
    tenantId: SYSTEM_TENANT_ID,
    roles: [],
  });
  return result.isSuccess && touchResultSchema.parse(result.data).retry;
}

function uploadOutcomeOf(result: {
  readonly isSuccess: boolean;
  readonly error?: { readonly details?: unknown };
}): z.infer<typeof uploadOutcomeSchema> | undefined {
  if (result.isSuccess) return "accepted";
  return result.error !== undefined &&
    failureReason(result.error) === ConnectorErrors.storageQuotaExceeded
    ? "quotaRejected"
    : undefined;
}

function badRequest(c: Context, description: string): Response {
  return c.json({ error: "invalid_request", error_description: description }, 400);
}

function decodedHeader(c: Context, name: string): string | undefined {
  const raw = c.req.header(name);
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

type UploadHeaders = {
  readonly relativePath: string;
  readonly sha256: string;
  readonly sourceModifiedAt: Temporal.Instant;
};

function parseUploadHeaders(c: Context): UploadHeaders | Response {
  const relativePath = normalizeRelativePath(decodedHeader(c, "x-kumiko-path") ?? "");
  if (relativePath === null)
    return badRequest(c, "X-Kumiko-Path is missing or not a relative path");
  if (isBallastPath(relativePath) || exceedsFolderLimits(relativePath))
    return c.json({ error: "path_rejected" }, 422);
  const sha256 = c.req.header("x-kumiko-sha256")?.toLowerCase() ?? "";
  if (!SHA256_PATTERN.test(sha256)) return badRequest(c, "X-Kumiko-Sha256 must be 64 hex digits");
  try {
    const sourceModifiedAt = Temporal.Instant.from(c.req.header("x-kumiko-mtime") ?? "");
    return { relativePath, sha256, sourceModifiedAt };
  } catch {
    return badRequest(c, "X-Kumiko-Mtime must be an ISO 8601 instant");
  }
}

function uploadFailureResponse(
  c: Context,
  error: { readonly code: string; readonly details?: unknown },
  itemId: string,
): Response {
  // A parallel delivery of the same file committed first: for the satellite that is a duplicate.
  // ponytail: a lost race answers 200 duplicate without re-reading the winner; re-read the item if satellites ever need its id from the body
  if (error.code === VERSION_CONFLICT_CODE) return c.json({ id: itemId, duplicate: true }, 200);
  const reason = failureReason(error);
  if (reason === ConnectorErrors.connectorRevoked)
    return c.json({ error: "connector_revoked" }, 403);
  if (reason === ConnectorErrors.storageQuotaExceeded) {
    return c.json({ error: "storage_quota_exceeded" }, 507);
  }
  if (reason === FrameworkReasons.fileRejected) return c.json({ error: "file_rejected" }, 422);
  return c.json({ error: "server_error" }, 500);
}

async function receiveUpload(
  c: Context,
  deps: SignatureExtraRouteDeps,
  maxUploadBytes: number,
): Promise<Response> {
  const device = await authenticateDevice(c, deps);
  if (device === null) return unauthorized(c);
  const tenantId = parseTenantId(device.ownerTenantId);
  if (tenantId === null) return unauthorized(c);

  const headers = parseUploadHeaders(c);
  if (headers instanceof Response) return headers;
  const { relativePath, sha256, sourceModifiedAt } = headers;

  const data = new Uint8Array(await c.req.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== sha256) {
    return badRequest(c, "body does not match X-Kumiko-Sha256");
  }

  const itemId = inboundItemAggregateId(device.connectorId, sha256, relativePath);
  const result = await deps.dispatchWriteAs({
    handlerQn: ConnectorHandlers.receiveFile,
    payload: {
      connectorId: device.connectorId,
      relativePath,
      sha256,
      sourceModifiedAt: sourceModifiedAt.toString(),
      mimeType: c.req.header("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
      maxBytes: maxUploadBytes,
      data,
    },
    tenantId,
    roles: [],
  });
  await touchDevice(deps, device, undefined, uploadOutcomeOf(result));

  if (result.isSuccess) {
    const { id, duplicate } = receivedSchema.parse(result.data);
    return c.json({ id, duplicate }, duplicate ? 200 : 201);
  }
  return uploadFailureResponse(c, result.error, itemId);
}

const log = createFallbackLogger("connectors");

// The name is a courtesy for the satellite UI: a failed lookup must not fail the heartbeat.
async function connectorNameOf(
  deps: SignatureExtraRouteDeps,
  device: AuthenticatedDevice,
): Promise<string | null> {
  try {
    const found = connectorNameSchema.parse(
      await deps.dispatchSystemQuery({
        handlerQn: ConnectorQueries.connectorName,
        payload: { connectorId: device.connectorId },
        tenantId: device.ownerTenantId,
      }),
    );
    return found?.name ?? null;
  } catch (error) {
    log.warn("connector name lookup failed, heartbeat answers without it", {
      connectorId: device.connectorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function receiveHeartbeat(c: Context, deps: SignatureExtraRouteDeps): Promise<Response> {
  const device = await authenticateDevice(c, deps);
  if (device === null) return unauthorized(c);
  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return badRequest(c, "body must be JSON");
  }
  const parsed = HEARTBEAT_SCHEMA.safeParse(body);
  if (!parsed.success) return badRequest(c, 'body must be {"version": "<1-64 characters>"}');
  const retry = await touchDevice(deps, device, parsed.data);
  const name = await connectorNameOf(deps, device);
  return c.json({ ok: true, ...(retry && { retry: true }), ...(name && { name }) }, 200);
}

// RFC 8628 §3.3.1: the code only prefills the pair screen; the admin still presses Check.
function completeUriOf(verificationUri: string, userCode: string): string {
  const url = new URL(verificationUri);
  url.searchParams.set("userCode", userCode);
  return url.toString();
}

function verificationUriOf(c: Context, options: ConnectorRouteOptions): string {
  const origin = publicOriginOf(process.env["APP_BASE_URL"] ?? "") ?? new URL(c.req.url).origin;
  return options.verificationUri ?? `${origin}/${ConnectorScreens.pair}`;
}

function pollOutcomeResponse(c: Context, outcome: z.infer<typeof pollOutcomeSchema>): Response {
  if (outcome.kind === "token" && outcome.accessToken !== undefined) {
    return c.json({ access_token: outcome.accessToken, token_type: "Bearer" }, 200, NO_STORE);
  }
  return oauthError(c, outcome.kind);
}

export function createConnectorRoutes(
  options: ConnectorRouteOptions = {},
): readonly ExtraRouteDefinition[] {
  const basePath = options.basePath ?? DEFAULT_CONNECTORS_BASE_PATH;
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  if (options.verificationUri !== undefined && !URL.canParse(options.verificationUri)) {
    throw new Error(
      `createConnectorRoutes: verificationUri must be an absolute URL, got "${options.verificationUri}"`,
    );
  }

  const deviceAuthorization = signatureRoute({
    method: "POST",
    path: `${basePath}${CONNECTOR_ROUTE_PATHS.deviceAuthorization}`,
    entry: "signature",
    rateLimit: {
      per: "ip",
      limit: options.pairingLimits?.startsPerMinute ?? PAIRING_STARTS_PER_MINUTE,
      windowSeconds: FORM_RATE_LIMIT_WINDOW_SECONDS,
    },
    verify: async ({ rawBody, headers }) => parseClientForm(rawBody, headers),
    handler: async (c, _form, deps) => {
      const started = await deps.dispatchWriteAs({
        handlerQn: ConnectorHandlers.deviceStart,
        payload: {
          requestIp: pairingAddressKey(deps.clientIp),
          maxStartsPerMinute: options.pairingLimits?.startsPerMinute ?? PAIRING_STARTS_PER_MINUTE,
          ...(options.pairingLimits?.maxOpenPerIp !== undefined && {
            maxOpenPerIp: options.pairingLimits.maxOpenPerIp,
          }),
          ...(options.pairingLimits?.maxOpenTotal !== undefined && {
            maxOpenTotal: options.pairingLimits.maxOpenTotal,
          }),
        },
        tenantId: SYSTEM_TENANT_ID,
        roles: [],
      });
      if (!started.isSuccess) return c.json({ error: "server_error" }, 500, NO_STORE);
      if (tooManyOpenSchema.safeParse(started.data).success) {
        return c.json({ error: "slow_down" }, 429, {
          ...NO_STORE,
          "Retry-After": String(PAIRING_FLOOD_RETRY_AFTER_SECONDS),
        });
      }
      const data = z
        .object({
          deviceCode: z.string(),
          userCode: z.string(),
          expiresIn: z.number(),
          interval: z.number(),
        })
        .parse(started.data);
      const verificationUri = verificationUriOf(c, options);
      return c.json(
        {
          device_code: data.deviceCode,
          user_code: data.userCode,
          verification_uri: verificationUri,
          verification_uri_complete: completeUriOf(verificationUri, data.userCode),
          expires_in: data.expiresIn,
          interval: data.interval,
        },
        200,
        NO_STORE,
      );
    },
  });

  const token = signatureRoute({
    method: "POST",
    path: `${basePath}${CONNECTOR_ROUTE_PATHS.token}`,
    entry: "signature",
    rateLimit: { per: "ip", limit: 120, windowSeconds: FORM_RATE_LIMIT_WINDOW_SECONDS },
    verify: async ({ rawBody, headers }) => {
      const form = parseClientForm(rawBody, headers);
      if (form.get("grant_type") !== DEVICE_CODE_GRANT_TYPE) {
        throw new ExtraRouteRejection(400, { error: "unsupported_grant_type" });
      }
      const deviceCode = form.get("device_code");
      if (deviceCode === null || deviceCode === "") {
        throw new ExtraRouteRejection(400, { error: "invalid_request" });
      }
      return { deviceCode };
    },
    handler: async (c, { deviceCode }, deps) => {
      const polled = await deps.dispatchWriteAs({
        handlerQn: ConnectorHandlers.devicePoll,
        payload: { deviceCode },
        tenantId: SYSTEM_TENANT_ID,
        roles: [],
      });
      if (!polled.isSuccess) return c.json({ error: "server_error" }, 500, NO_STORE);
      return pollOutcomeResponse(c, pollOutcomeSchema.parse(polled.data));
    },
  });

  const files = binaryBodySignatureRoute({
    method: "POST",
    path: `${basePath}${CONNECTOR_ROUTE_PATHS.files}`,
    entry: "signature",
    binaryBody: { maxBytes: maxUploadBytes },
    rateLimit: { per: "ip", ...UPLOAD_RATE_LIMIT },
    verify: async ({ headers }) => verifyBearerFormat(headers),
    handler: (c, _verified, deps) => receiveUpload(c, deps, maxUploadBytes),
  });

  const heartbeat = binaryBodySignatureRoute({
    method: "POST",
    path: `${basePath}${CONNECTOR_ROUTE_PATHS.heartbeat}`,
    entry: "signature",
    binaryBody: { maxBytes: HEARTBEAT_MAX_BODY_BYTES },
    rateLimit: { per: "ip", ...HEARTBEAT_RATE_LIMIT },
    verify: async ({ headers }) => verifyBearerFormat(headers),
    handler: (c, _verified, deps) => receiveHeartbeat(c, deps),
  });

  return [deviceAuthorization, token, files, heartbeat];
}
