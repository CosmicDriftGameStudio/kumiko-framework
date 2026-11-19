import type { SignatureExtraRouteDeps } from "@cosmicdrift/kumiko-framework/api";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { Context } from "hono";
import * as z from "zod";
import { ConnectorQueries, DEVICE_TOKEN_PATTERN, RELATIVE_PATH_MAX_LENGTH } from "./constants.ts";
import { hashDeviceSecret } from "./hash.ts";

export type AuthenticatedDevice = {
  readonly deviceId: string;
  readonly ownerTenantId: string;
  readonly connectorId: string;
  readonly lastSeenAt: string | null;
};

const resolvedDeviceSchema = z
  .object({
    deviceId: z.string(),
    ownerTenantId: z.string(),
    connectorId: z.string(),
    lastSeenAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .nullable();

export function bearerTokenOf(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined) return null;
  const match = /^Bearer (\S+)$/.exec(authorizationHeader);
  const token = match?.[1];
  return token !== undefined && DEVICE_TOKEN_PATTERN.test(token) ? token : null;
}

// Runs before any body read and any privileged dispatch. Null for every failure (malformed, unknown,
// revoked), so the route answers all of them alike.
export async function authenticateDevice(
  c: Context,
  deps: Pick<SignatureExtraRouteDeps, "dispatchSystemQuery">,
): Promise<AuthenticatedDevice | null> {
  const token = bearerTokenOf(c.req.header("authorization"));
  if (token === null) return null;
  const resolved = resolvedDeviceSchema.parse(
    await deps.dispatchSystemQuery({
      handlerQn: ConnectorQueries.resolveDevice,
      payload: { tokenHash: hashDeviceSecret(token) },
      tenantId: SYSTEM_TENANT_ID,
    }),
  );
  if (resolved === null || resolved.revokedAt !== null) return null;
  return {
    deviceId: resolved.deviceId,
    ownerTenantId: resolved.ownerTenantId,
    connectorId: resolved.connectorId,
    lastSeenAt: resolved.lastSeenAt,
  };
}

const DRIVE_LETTER_PATTERN = /^[A-Za-z]:/;
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

// Satellites run on Windows shares: separators arrive as backslashes. Anything that could leave the
// source folder (.., absolute paths, drive letters, UNC) is rejected rather than cleaned up.
export function normalizeRelativePath(raw: string): string | null {
  const slashed = raw.replaceAll("\\", "/");
  if (slashed === "" || slashed.startsWith("/") || DRIVE_LETTER_PATTERN.test(slashed)) return null;
  if (hasControlCharacter(slashed)) return null;
  const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  const normalized = segments.join("/");
  return normalized.length <= RELATIVE_PATH_MAX_LENGTH ? normalized : null;
}
