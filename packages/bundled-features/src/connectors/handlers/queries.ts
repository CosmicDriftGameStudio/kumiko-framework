import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  defineQueryHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import {
  ConnectorErrors,
  ConnectorQueries,
  DEVICE_AUTHORIZATION_STATUS,
  PENDING_REQUEST_RATE_LIMIT,
} from "../constants.ts";
import { hashUserCode, normalizeUserCode } from "../hash.ts";
import { connectorTable } from "../schema/connector.ts";
import { deviceTable } from "../schema/device.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

type DeviceRow = {
  readonly id: string;
  readonly ownerTenantId: string;
  readonly connectorId: string;
  readonly tokenPrefix: string;
  readonly reportedVersion: string | null;
  readonly lastSeenAt: Temporal.Instant | null;
  readonly createdAt: Temporal.Instant;
  readonly revokedAt: Temporal.Instant | null;
};

const isoOrNull = (instant: Temporal.Instant | null): string | null =>
  instant === null ? null : instant.toString();

// Hot path of every satellite request: one point read by token hash, no tenant context yet.
export const resolveDeviceQuery = defineQueryHandler({
  name: "resolve-device",
  schema: z.object({ tokenHash: z.string().length(64) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: finds the device a token hash belongs to, with its tenant, connector and revocation state.",
  handler: async (query, ctx) => {
    const row = await fetchOne<DeviceRow>(ctx.db, deviceTable, {
      tokenHash: query.payload.tokenHash,
    });
    if (row === undefined) return null;
    return {
      deviceId: row.id,
      ownerTenantId: row.ownerTenantId,
      connectorId: row.connectorId,
      lastSeenAt: isoOrNull(row.lastSeenAt),
      revokedAt: isoOrNull(row.revokedAt),
    };
  },
});

export const listDevicesQuery = defineQueryHandler({
  name: "list-devices",
  schema: z.object({ ownerTenantId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description: "Internal: the paired devices of one tenant's connectors, without token material.",
  handler: async (query, ctx) =>
    (
      await selectMany<DeviceRow>(ctx.db, deviceTable, {
        ownerTenantId: query.payload.ownerTenantId,
      })
    ).map((row) => ({
      connectorId: row.connectorId,
      tokenPrefix: row.tokenPrefix,
      reportedVersion: row.reportedVersion,
      lastSeenAt: isoOrNull(row.lastSeenAt),
      revokedAt: isoOrNull(row.revokedAt),
    })),
});

const LIST_DEVICES_REASON =
  "device rows live in the system tenant (the device has no tenant until it is paired); the list reads only the caller's own tenant's devices, by ownerTenantId taken from the session";

const deviceSummariesSchema = z.array(
  z.object({
    connectorId: z.string(),
    reportedVersion: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  }),
);

type ConnectorRow = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly insertedAt: Temporal.Instant;
};

type PendingAuthorizationRow = {
  readonly requestIp: string;
  readonly createdAt: Temporal.Instant;
  readonly expiresAt: Temporal.Instant;
};

export const resolvePendingAuthorizationQuery = defineQueryHandler({
  name: "resolve-pending-authorization",
  schema: z.object({ userCodeHash: z.string().length(64) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: reads when and from which IP a still pending, unexpired device pairing was requested.",
  handler: async (query, ctx) => {
    const [row] = await selectMany<PendingAuthorizationRow>(ctx.db, deviceAuthorizationTable, {
      userCodeHash: query.payload.userCodeHash,
      status: DEVICE_AUTHORIZATION_STATUS.pending,
      expiresAt: { gt: ctx.tz.now() },
    });
    if (row === undefined) return null;
    return {
      requestedAt: row.createdAt.toString(),
      requestIp: row.requestIp,
      expiresAt: row.expiresAt.toString(),
    };
  },
});

const pendingRequestSchema = z
  .object({ requestedAt: z.string(), requestIp: z.string(), expiresAt: z.string() })
  .nullable();

const PENDING_REQUEST_REASON =
  "pairing requests live in the system tenant (the device has no tenant before an admin confirms its code); the query returns time and IP of exactly the one request whose code the admin typed, and nothing for an unknown, expired or confirmed code";

export const pendingRequestQuery = defineQueryHandler({
  name: "pending-request",
  schema: z.object({ userCode: z.string().min(1).max(32) }),
  access: { roles: access.admin },
  rateLimit: PENDING_REQUEST_RATE_LIMIT,
  escapeHatch: { grants: ["systemIdentity"], reason: PENDING_REQUEST_REASON },
  agent: { expose: false },
  description:
    "Shows when and from which IP address a satellite requested the pairing code an admin is about to confirm. Use it to check that the request is yours before you confirm the code.",
  handler: async (query, ctx) => {
    const normalized = normalizeUserCode(query.payload.userCode);
    if (normalized === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    const pending = pendingRequestSchema.parse(
      await ctx.dispatch.queryAs(
        createSystemUser(SYSTEM_TENANT_ID),
        ConnectorQueries.resolvePendingAuthorization,
        { userCodeHash: hashUserCode(normalized) },
      ),
    );
    if (pending === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    return pending;
  },
});

export const listConnectorsQuery = defineQueryHandler({
  name: "list",
  schema: z.object({}),
  access: { roles: access.admin },
  escapeHatch: { grants: ["systemIdentity"], reason: LIST_DEVICES_REASON },
  description:
    "Lists the tenant's connectors with their status and, per connector, when its device was last seen and which software version it reported. Use it to check which satellites are paired and alive.",
  handler: async (query, ctx) => {
    const connectors = (await selectMany<ConnectorRow>(ctx.db, connectorTable, {})).toSorted(
      (a, b) => Temporal.Instant.compare(b.insertedAt, a.insertedAt),
    );
    const devices = deviceSummariesSchema.parse(
      await ctx.dispatch.queryAs(createSystemUser(SYSTEM_TENANT_ID), ConnectorQueries.listDevices, {
        ownerTenantId: query.user.tenantId,
      }),
    );
    const rows = connectors.map((connector) => {
      const live = devices.find(
        (device) => device.connectorId === connector.id && device.revokedAt === null,
      );
      return {
        id: connector.id,
        name: connector.name,
        kind: connector.kind,
        status: connector.status,
        createdAt: connector.insertedAt.toString(),
        lastSeenAt: live?.lastSeenAt ?? null,
        reportedVersion: live?.reportedVersion ?? null,
      };
    });
    return { rows, nextCursor: null };
  },
});
