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
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Context } from "hono";
import * as z from "zod";
import { inboundItemAggregateId } from "./aggregate-id.ts";
import {
  CONNECTOR_CLIENT_ID,
  ConnectorErrors,
  ConnectorHandlers,
  ConnectorScreens,
  DEFAULT_CONNECTORS_BASE_PATH,
  DEFAULT_MAX_UPLOAD_BYTES,
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

export type ConnectorRouteOptions = {
  /** Mount point of the satellite endpoints. Default "/connectors". Must not be under "/api/". */
  readonly basePath?: string;
  /** Per-file cap in bytes. Default 50 MiB. */
  readonly maxUploadBytes?: number;
  /** Page where a TenantAdmin confirms the user code; shown to the satellite. Default: the
   *  public app URL (APP_BASE_URL), else the address the satellite reached the app on, plus "/connector-pair" (the pairing screen's URL
   *  in an app without workspaces or a base path; set this option otherwise). */
  readonly verificationUri?: string;
  /** Flood protection of the pairing start (client_id is public). Defaults: 10 starts per minute and
   *  address, 3 open requests per address, 1000 open requests overall. */
  readonly pairingLimits?: {
    readonly startsPerMinute?: number;
    readonly maxOpenPerIp?: number;
    readonly maxOpenTotal?: number;
  };
};

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const FORM_RATE_LIMIT_WINDOW_SECONDS = 60;
const HEARTBEAT_SCHEMA = z.object({ version: z.string().min(1).max(64) });
const tooManyOpenSchema = z.object({ tooManyOpenRequests: z.literal(true) });
const receivedSchema = z.object({ duplicate: z.boolean() });
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
  reportedVersion?: string,
): Promise<void> {
  await deps.dispatchWriteAs({
    handlerQn: ConnectorHandlers.touchDevice,
    payload: { deviceId: device.deviceId, ...(reportedVersion && { reportedVersion }) },
    tenantId: SYSTEM_TENANT_ID,
    roles: [],
  });
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

async function receiveUpload(
  c: Context,
  deps: SignatureExtraRouteDeps,
  maxUploadBytes: number,
): Promise<Response> {
  const device = await authenticateDevice(c, deps);
  if (device === null) return unauthorized(c);
  const tenantId = parseTenantId(device.ownerTenantId);
  if (tenantId === null) return unauthorized(c);

  const relativePath = normalizeRelativePath(decodedHeader(c, "x-kumiko-path") ?? "");
  if (relativePath === null)
    return badRequest(c, "X-Kumiko-Path is missing or not a relative path");
  const sha256 = c.req.header("x-kumiko-sha256")?.toLowerCase() ?? "";
  if (!SHA256_PATTERN.test(sha256)) return badRequest(c, "X-Kumiko-Sha256 must be 64 hex digits");
  let sourceModifiedAt: Temporal.Instant;
  try {
    sourceModifiedAt = Temporal.Instant.from(c.req.header("x-kumiko-mtime") ?? "");
  } catch {
    return badRequest(c, "X-Kumiko-Mtime must be an ISO 8601 instant");
  }

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
  await touchDevice(deps, device);

  if (result.isSuccess) {
    const { duplicate } = receivedSchema.parse(result.data);
    return c.json({ id: itemId, duplicate }, duplicate ? 200 : 201);
  }
  const { code } = result.error;
  // A parallel delivery of the same file committed first: for the satellite that is a duplicate.
  // ponytail: a lost race answers 200 duplicate without re-reading the winner; re-read the item if satellites ever need its id from the body
  if (code === VERSION_CONFLICT_CODE) return c.json({ id: itemId, duplicate: true }, 200);
  const reason = failureReason(result.error);
  if (reason === ConnectorErrors.connectorRevoked)
    return c.json({ error: "connector_revoked" }, 403);
  if (reason === FrameworkReasons.fileRejected) return c.json({ error: "file_rejected" }, 422);
  return c.json({ error: "server_error" }, 500);
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
  await touchDevice(deps, device, parsed.data.version);
  return c.json({ ok: true }, 200);
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

  const deviceAuthorization = signatureRoute({
    method: "POST",
    path: `${basePath}/v1/device_authorization`,
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
          requestIp: deps.clientIp,
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
    path: `${basePath}/v1/token`,
    entry: "signature",
    rateLimit: { per: "ip", limit: 120, windowSeconds: FORM_RATE_LIMIT_WINDOW_SECONDS },
    verify: async ({ rawBody, headers }) => {
      const form = parseClientForm(rawBody, headers);
      if (form.get("grant_type") !== DEVICE_GRANT_TYPE) {
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
    path: `${basePath}/v1/files`,
    entry: "signature",
    binaryBody: { maxBytes: maxUploadBytes },
    rateLimit: { per: "ip", ...UPLOAD_RATE_LIMIT },
    verify: async ({ headers }) => verifyBearerFormat(headers),
    handler: (c, _verified, deps) => receiveUpload(c, deps, maxUploadBytes),
  });

  const heartbeat = binaryBodySignatureRoute({
    method: "POST",
    path: `${basePath}/v1/heartbeat`,
    entry: "signature",
    binaryBody: { maxBytes: HEARTBEAT_MAX_BODY_BYTES },
    rateLimit: { per: "ip", ...HEARTBEAT_RATE_LIMIT },
    verify: async ({ headers }) => verifyBearerFormat(headers),
    handler: (c, _verified, deps) => receiveHeartbeat(c, deps),
  });

  return [deviceAuthorization, token, files, heartbeat];
}
