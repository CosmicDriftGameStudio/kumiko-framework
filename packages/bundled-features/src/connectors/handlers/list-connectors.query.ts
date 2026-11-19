import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  defineQueryHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { ConnectorQueries, SYNC_STATE, SYNC_STATUS } from "../constants.ts";
import { connectorTable } from "../schema/connector.ts";
import { physicalStoredBytes } from "../stored-bytes.ts";

const LIST_DEVICES_REASON =
  "device rows live in the system tenant (the device has no tenant until it is paired); the list reads only the caller's own tenant's devices, by ownerTenantId taken from the session";

const deviceSummariesSchema = z.array(
  z.object({
    connectorId: z.string(),
    reportedVersion: z.string().nullable(),
    syncState: z.string().nullable(),
    syncQueued: z.number().nullable(),
    syncFailed: z.number().nullable(),
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

type SyncReport = { state: string | null; queued: number | null; failed: number | null };

function syncStatusOf({ state, failed }: SyncReport): string {
  if (state === null) return SYNC_STATUS.unknown;
  if ((failed ?? 0) > 0 || state === SYNC_STATE.error) return SYNC_STATUS.failed;
  return state === SYNC_STATE.syncing ? SYNC_STATUS.syncing : SYNC_STATUS.synced;
}

// Text for the "Details" column: counts the badge cannot carry.
function syncDetailOf(status: string, report: SyncReport, storageFull: boolean) {
  const { queued, failed } = report;
  if (storageFull && report.state !== null && report.state !== SYNC_STATE.idle) {
    return { i18nKey: "connectors.sync.detail.storageFull" };
  }
  if (status === SYNC_STATUS.failed && (failed ?? 0) > 0) {
    return { i18nKey: "connectors.list.sync.failedCount", i18nParams: { count: failed ?? 0 } };
  }
  if (status === SYNC_STATUS.syncing) {
    return { i18nKey: "connectors.list.sync.queued", i18nParams: { count: queued ?? 0 } };
  }
  return null;
}

export function createListConnectorsQuery(maxStoredBytes: number) {
  return defineQueryHandler({
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
        await ctx.dispatch.queryAs(
          createSystemUser(SYSTEM_TENANT_ID),
          ConnectorQueries.listDevices,
          {
            ownerTenantId: query.user.tenantId,
          },
        ),
      );
      const storageFull = (await physicalStoredBytes(ctx.db)) >= maxStoredBytes;
      const rows = connectors.map((connector) => {
        const live = devices.find(
          (device) => device.connectorId === connector.id && device.revokedAt === null,
        );
        const report: SyncReport = {
          state: live?.syncState ?? null,
          queued: live?.syncQueued ?? null,
          failed: live?.syncFailed ?? null,
        };
        const syncStatus = syncStatusOf(report);
        return {
          syncStatus,
          syncDetail: syncDetailOf(syncStatus, report, storageFull),
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
}
