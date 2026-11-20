export const FILE_NAME_CELL_COMPONENT = "ConnectorFileNameCell" as const;

export const ConnectorScreens = {
  list: "connector-list",
  pair: "connector-pair",
  confirm: "connector-confirm",
  files: "connector-files",
} as const;

export const ConnectorHandlers = {
  checkDevice: "connectors:write:check-device",
  approveDevice: "connectors:write:approve-device",
  revoke: "connectors:write:revoke",
  deviceStart: "connectors:write:device-start",
  devicePoll: "connectors:write:device-poll",
  claimAuthorization: "connectors:write:claim-authorization",
  markChecked: "connectors:write:mark-device-checked",
  revokeDeviceTokens: "connectors:write:revoke-device-tokens",
  touchDevice: "connectors:write:touch-device",
  requestRetry: "connectors:write:request-retry",
  markDeviceRetry: "connectors:write:mark-device-retry",
  receiveFile: "connectors:write:receive-file",
  deleteFile: "connectors:write:delete-file",
  deleteFolder: "connectors:write:delete-folder",
} as const;

export const ConnectorQueries = {
  list: "connectors:query:list",
  resolveDevice: "connectors:query:resolve-device",
  connectorName: "connectors:query:connector-name",
  listDevices: "connectors:query:list-devices",
  pendingRequest: "connectors:query:pending-request",
  resolvePendingAuthorization: "connectors:query:resolve-pending-authorization",
  inboundFolder: "connectors:query:inbound-folder",
  inboundSearch: "connectors:query:inbound-search",
} as const;
