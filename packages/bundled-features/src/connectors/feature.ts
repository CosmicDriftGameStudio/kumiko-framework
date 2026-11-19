import {
  defineFeature,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CONNECTOR_ENTITY,
  CONNECTORS_FEATURE,
  DEFAULT_MAX_STORED_BYTES_PER_TENANT,
  FOLDER_DELETE_BATCH_SIZE,
  INBOUND_FOLDER_ENTITY,
  INBOUND_ITEM_ENTITY,
  MAX_SEARCH_NAMES,
} from "./constants.ts";
import { deleteFolderTreeJob } from "./delete-folder-tree.job.ts";
import { approveDeviceWrite } from "./handlers/approve-device.write.ts";
import { checkDeviceWrite } from "./handlers/check-device.write.ts";
import { claimAuthorizationWrite } from "./handlers/claim-authorization.write.ts";
import { deleteFileWrite } from "./handlers/delete-file.write.ts";
import { deleteFolderWrite } from "./handlers/delete-folder.write.ts";
import { devicePollWrite } from "./handlers/device-poll.write.ts";
import { deviceStartWrite } from "./handlers/device-start.write.ts";
import { createInboundFolderQuery } from "./handlers/inbound-folder.query.ts";
import { createInboundSearchQuery } from "./handlers/inbound-search.query.ts";
import { listConnectorsQuery } from "./handlers/list-connectors.query.ts";
import { listDevicesQuery } from "./handlers/list-devices.query.ts";
import { markDeviceCheckedWrite } from "./handlers/mark-device-checked.write.ts";
import { markDeviceRetryWrite } from "./handlers/mark-device-retry.write.ts";
import { pendingRequestQuery } from "./handlers/pending-request.query.ts";
import { createReceiveFileWrite } from "./handlers/receive-file.write.ts";
import { requestRetryWrite } from "./handlers/request-retry.write.ts";
import { resolveDeviceQuery } from "./handlers/resolve-device.query.ts";
import { resolvePendingAuthorizationQuery } from "./handlers/resolve-pending-authorization.query.ts";
import { revokeConnectorWrite } from "./handlers/revoke.write.ts";
import { revokeDeviceTokensWrite } from "./handlers/revoke-device-tokens.write.ts";
import { touchDeviceWrite } from "./handlers/touch-device.write.ts";
import { CONNECTORS_I18N } from "./i18n.ts";
import { connectorEntity } from "./schema/connector.ts";
import { deviceTable } from "./schema/device.ts";
import { deviceAuthorizationTable } from "./schema/device-authorization.ts";
import { inboundFolderEntity } from "./schema/inbound-folder.ts";
import { inboundItemEntity } from "./schema/inbound-item.ts";
import {
  connectorConfirmScreen,
  connectorFilesScreen,
  connectorListScreen,
  connectorPairScreen,
} from "./screens.ts";
import {
  CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON,
  connectorTenantDestroyHook,
  inboundFolderTenantDestroyHook,
  inboundItemTenantDestroyHook,
} from "./tenant-destroy-hook.ts";

// Mount the satellite endpoints separately: `extraRoutes: createConnectorRoutes()` on the server.
export type ConnectorsFeatureOptions = {
  /** Storage quota over all connectors of a tenant, in bytes; the files screen shows usage against it. Default 5 GiB. */
  readonly maxStoredBytesPerTenant?: number;
  /** Files the folder deletion job removes per batch. Default 100; lower it only in tests. */
  readonly folderDeleteBatchSize?: number;
  /** Names one file search decrypts and scans before it answers `truncated`. Default 20 000; lower it only in tests. */
  readonly maxSearchNames?: number;
};

export function createConnectorsFeature(options: ConnectorsFeatureOptions = {}): FeatureDefinition {
  const maxStoredBytes = options.maxStoredBytesPerTenant ?? DEFAULT_MAX_STORED_BYTES_PER_TENANT;
  const folderDeleteBatchSize = options.folderDeleteBatchSize ?? FOLDER_DELETE_BATCH_SIZE;
  const maxSearchNames = options.maxSearchNames ?? MAX_SEARCH_NAMES;
  return defineFeature(CONNECTORS_FEATURE, (r) => {
    r.describe(
      "Lets a satellite program on a customer's own machine deliver files into the app. The satellite pairs through the OAuth device flow (RFC 8628): it shows a short code, a tenant admin confirms it, and the satellite receives a revocable `ksat_` device token of which only the SHA-256 is stored. With that token it uploads files (raw bytes plus relative path, SHA-256 and modification time; the same file again is the same item) and sends heartbeats. Each upload becomes a file reference plus an event-sourced `inbound-item`; other features consume its created event. The HTTP endpoints are not handlers: mount `createConnectorRoutes()` from `@cosmicdrift/kumiko-bundled-features/connectors` as `extraRoutes` (they live outside /api, so the satellite needs no session). The wire protocol is described in docs/guides/connectors-satellite.md.",
    );
    r.uiHints({ displayLabel: "Connectors", category: "integration", recommended: false });
    r.requires({ features: ["files", "tenant", "tenant-lifecycle"] });

    // Both are lookups by secret hash and rewritten on every poll or heartbeat, so they are not
    // rebuildable projections: a replay has no events to restore them from.
    r.storeTable(deviceAuthorizationTable, {
      reason: "read_side.connector_device_authorizations_direct_write",
    });
    r.storeTable(deviceTable, { reason: "read_side.connector_devices_direct_write" });

    r.entity(connectorEntity);
    r.entity(inboundItemEntity);
    r.entity(inboundFolderEntity);
    r.applyExtension({
      name: EXT_TENANT_DATA,
      entity: INBOUND_FOLDER_ENTITY,
      destroy: inboundFolderTenantDestroyHook,
      escapeHatch: { reason: CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON },
    });
    r.applyExtension({
      name: EXT_TENANT_DATA,
      entity: CONNECTOR_ENTITY,
      destroy: connectorTenantDestroyHook,
      escapeHatch: { reason: CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON },
    });
    r.applyExtension({
      name: EXT_TENANT_DATA,
      entity: INBOUND_ITEM_ENTITY,
      destroy: inboundItemTenantDestroyHook,
      escapeHatch: { reason: CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON },
    });

    r.writeHandler(checkDeviceWrite);
    r.writeHandler(approveDeviceWrite);
    r.writeHandler(revokeConnectorWrite);
    r.writeHandler(deviceStartWrite);
    r.writeHandler(devicePollWrite);
    r.writeHandler(claimAuthorizationWrite);
    r.writeHandler(markDeviceCheckedWrite);
    r.writeHandler(revokeDeviceTokensWrite);
    r.writeHandler(touchDeviceWrite);
    r.writeHandler(requestRetryWrite);
    r.writeHandler(markDeviceRetryWrite);
    r.writeHandler(createReceiveFileWrite(maxStoredBytes));
    r.writeHandler(deleteFileWrite);
    r.writeHandler(deleteFolderWrite);
    r.queryHandler(listConnectorsQuery);
    r.queryHandler(resolveDeviceQuery);
    r.queryHandler(listDevicesQuery);
    r.queryHandler(pendingRequestQuery);
    r.queryHandler(resolvePendingAuthorizationQuery);
    r.queryHandler(createInboundFolderQuery(maxStoredBytes));
    r.queryHandler(createInboundSearchQuery(maxSearchNames));

    r.job({
      name: "delete-folder-tree",
      trigger: { on: "inbound-folder.updated" },
      retries: 3,
      // The admin's click goes through the high-risk delete-folder handler; this job only carries out that request.
      irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline",
      // Inline so the feature-AST reader can parse the job; the logic lives in delete-folder-tree.job.ts.
      handler: (payload, ctx) => deleteFolderTreeJob(payload, ctx, folderDeleteBatchSize),
    });

    r.screen(connectorListScreen);
    r.screen(connectorPairScreen);
    r.screen(connectorConfirmScreen);
    r.screen(connectorFilesScreen);

    r.translations({ keys: CONNECTORS_I18N });
  });
}
