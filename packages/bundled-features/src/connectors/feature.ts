import {
  defineFeature,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { CONNECTOR_ENTITY, CONNECTORS_FEATURE, INBOUND_ITEM_ENTITY } from "./constants.ts";
import { approveDeviceWrite } from "./handlers/approve-device.write.ts";
import { checkDeviceWrite } from "./handlers/check-device.write.ts";
import { claimAuthorizationWrite } from "./handlers/claim-authorization.write.ts";
import { devicePollWrite } from "./handlers/device-poll.write.ts";
import { deviceStartWrite } from "./handlers/device-start.write.ts";
import { listConnectorsQuery } from "./handlers/list-connectors.query.ts";
import { listDevicesQuery } from "./handlers/list-devices.query.ts";
import { markDeviceCheckedWrite } from "./handlers/mark-device-checked.write.ts";
import { pendingRequestQuery } from "./handlers/pending-request.query.ts";
import { receiveFileWrite } from "./handlers/receive-file.write.ts";
import { resolveDeviceQuery } from "./handlers/resolve-device.query.ts";
import { resolvePendingAuthorizationQuery } from "./handlers/resolve-pending-authorization.query.ts";
import { revokeConnectorWrite } from "./handlers/revoke.write.ts";
import { revokeDeviceTokensWrite } from "./handlers/revoke-device-tokens.write.ts";
import { touchDeviceWrite } from "./handlers/touch-device.write.ts";
import { CONNECTORS_I18N } from "./i18n.ts";
import { connectorEntity } from "./schema/connector.ts";
import { deviceTable } from "./schema/device.ts";
import { deviceAuthorizationTable } from "./schema/device-authorization.ts";
import { inboundItemEntity } from "./schema/inbound-item.ts";
import { connectorConfirmScreen, connectorListScreen, connectorPairScreen } from "./screens.ts";
import {
  CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON,
  connectorTenantDestroyHook,
  inboundItemTenantDestroyHook,
} from "./tenant-destroy-hook.ts";

// Mount the satellite endpoints separately: `extraRoutes: createConnectorRoutes()` on the server.
export function createConnectorsFeature(): FeatureDefinition {
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
    r.writeHandler(receiveFileWrite);
    r.queryHandler(listConnectorsQuery);
    r.queryHandler(resolveDeviceQuery);
    r.queryHandler(listDevicesQuery);
    r.queryHandler(pendingRequestQuery);
    r.queryHandler(resolvePendingAuthorizationQuery);

    r.screen(connectorListScreen);
    r.screen(connectorPairScreen);
    r.screen(connectorConfirmScreen);

    r.translations({ keys: CONNECTORS_I18N });
  });
}
