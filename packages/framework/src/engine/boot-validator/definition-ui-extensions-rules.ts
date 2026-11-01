import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_UI_EXTENSION_RULES = {
  extensionSelectorPanelIdInvalid: {
    id: "extension-selector/panel-id-invalid",
    summary: "Extension selector panel ids are unique, non-empty and not the reserved selector id.",
    fix: "Give each panel its own id and avoid the reserved selector panel id.",
  },
  extensionSelectorScreenPanelLabel: {
    id: "extension-selector/screen-panel-label",
    summary: "An extension selector screen panel sets no label.",
    fix: "Remove the label; the embedded screen carries its own title.",
  },
  extensionSelectorPanelKindUnsupported: {
    id: "extension-selector/panel-kind-unsupported",
    summary: "Extension selector panels are of kind custom or screen.",
    fix: 'Use a panel of kind "custom" or "screen".',
  },
  navIdNotKebab: {
    id: "nav/id-not-kebab",
    summary: "Nav ids are kebab-case.",
    fix: "Rename the nav id to lowercase letters, digits and dashes, starting with a letter.",
  },
  navIdDuplicate: {
    id: "nav/id-duplicate",
    summary: "Nav ids are unique per feature.",
    fix: "Remove the standalone r.nav() call or the screen's inline nav.",
  },
  hookValidationEscapeHatch: {
    id: "hook/validation-escape-hatch",
    summary: "Validation hooks declare no escapeHatch.",
    fix: "Remove escapeHatch from the validation hook.",
  },
  hookEscapeHatchInvalid: {
    id: "hook/escape-hatch-invalid",
    summary: "A hook escapeHatch carries a valid reason and grants.",
    fix: "Fix the escapeHatch reason or grants as the message describes.",
  },
  hookAllOfUnsupportedType: {
    id: "hook/all-of-unsupported-type",
    summary: "Hooks with target allOf are postSave, preDelete, postDelete or postQuery.",
    fix: "Use a supported hook type or a different target.",
  },
  hookTypeUnknown: {
    id: "hook/type-unknown",
    summary: "Hooks use a known hook type.",
    fix: "Use a valid hook type; preQuery hooks were removed.",
  },
  useExtensionEscapeHatchInvalid: {
    id: "extension/use-escape-hatch-invalid",
    summary: "r.useExtension() escapeHatch carries a valid reason and grants.",
    fix: 'Pass escapeHatch as { reason: "<explanation>" } with valid grants.',
  },
  extensionSelectorDuplicate: {
    id: "extension-selector/duplicate",
    summary: "Each extension point has at most one selector.",
    fix: "Declare one extensionSelector per extension.",
  },
  exposesApiTwice: {
    id: "api/exposes-called-twice",
    summary: "An API name is exposed once per feature.",
    fix: "Remove the duplicate r.exposesApi() call or rename it.",
  },
  projectionNameNotKebab: {
    id: "projection/name-not-kebab",
    summary: "Projection names are kebab-case.",
    fix: "Rename the projection to lowercase letters, digits and dashes.",
  },
  projectionNameDuplicate: {
    id: "projection/name-duplicate",
    summary: "Projection names are unique per feature.",
    fix: "Rename one of the projections.",
  },
  multiStreamProjectionNameNotKebab: {
    id: "projection/multi-stream-name-not-kebab",
    summary: "Multi-stream projection names are kebab-case.",
    fix: "Rename the projection to lowercase letters, digits and dashes.",
  },
  multiStreamProjectionNameDuplicate: {
    id: "projection/multi-stream-name-duplicate",
    summary: "r.projection and r.multiStreamProjection share one name space per feature.",
    fix: "Pick a unique short name.",
  },
  multiStreamProjectionWithoutApply: {
    id: "projection/multi-stream-without-apply",
    summary: "A multi-stream projection declares at least one apply handler.",
    fix: "Declare at least one event type the projection reacts to.",
  },
  extendEntityProjectionWithoutApply: {
    id: "projection/extend-without-apply",
    summary: "extendEntityProjection declares at least one apply handler.",
    fix: "Declare at least one event type to apply.",
  },
  screenIdNotKebab: {
    id: "screen/id-not-kebab",
    summary: "Screen ids are kebab-case.",
    fix: "Rename the screen id to lowercase letters, digits and dashes.",
  },
  screenIdDuplicate: {
    id: "screen/id-duplicate",
    summary: "Screen ids are unique per feature.",
    fix: "Rename one of the screens.",
  },
  contentCollectionIdDuplicate: {
    id: "content-collection/id-duplicate",
    summary: "Content collection ids are unique per feature.",
    fix: "Rename one of the collections.",
  },
  workspaceIdNotKebab: {
    id: "workspace/id-not-kebab",
    summary: "Workspace ids are kebab-case.",
    fix: "Rename the workspace id to lowercase letters, digits and dashes.",
  },
  workspaceIdDuplicate: {
    id: "workspace/id-duplicate",
    summary: "Workspace ids are unique per feature.",
    fix: "Rename one of the workspaces.",
  },
  httpRoutePathNotAbsolute: {
    id: "http-route/path-not-absolute",
    summary: "HTTP route paths start with a slash.",
    fix: 'Prefix the route path with "/".',
  },
  httpRoutePathReserved: {
    id: "http-route/path-reserved",
    summary: "HTTP route paths stay out of the reserved /api namespace.",
    fix: "Pick a path outside /api or use a query or write handler.",
  },
  httpRouteAnonymousMissing: {
    id: "http-route/anonymous-missing",
    summary: "HTTP routes declare anonymous as true or false.",
    fix: "Set anonymous: true for public routes or false for session-authenticated ones.",
  },
  httpRouteRateLimitInvalid: {
    id: "http-route/rate-limit-invalid",
    summary: "HTTP route rateLimit has a positive integer limit and windowSeconds.",
    fix: "Set limit and windowSeconds to positive integers.",
  },
  httpRouteDuplicate: {
    id: "http-route/duplicate",
    summary: "HTTP routes are unique per method and path within a feature.",
    fix: "Remove the duplicate route or change its method or path.",
  },
  webSocketRoutePathPrefix: {
    id: "websocket-route/path-prefix",
    summary: "WebSocket route paths live under the WebSocket namespace prefix.",
    fix: "Start the path with the prefix named in the message.",
  },
  webSocketRoutePathWildcard: {
    id: "websocket-route/path-wildcard",
    summary: "WebSocket route paths contain no wildcard.",
    fix: "Remove the * from the path.",
  },
  webSocketRouteMaxMessageBytesInvalid: {
    id: "websocket-route/max-message-bytes-invalid",
    summary: "WebSocket maxMessageBytes is an integer within the allowed range.",
    fix: "Set maxMessageBytes to an integer within the range in the message.",
  },
  webSocketRouteMaxConnectionsInvalid: {
    id: "websocket-route/max-connections-invalid",
    summary: "WebSocket maxConnectionsPerUser is an integer within the allowed range.",
    fix: "Set maxConnectionsPerUser to an integer within the range in the message.",
  },
  webSocketRouteDuplicate: {
    id: "websocket-route/duplicate",
    summary: "WebSocket route paths are unique per feature.",
    fix: "Remove the duplicate route or change its path.",
  },
  storeTableNameInvalid: {
    id: "store-table/name-invalid",
    summary: "Store table names are valid lowercase identifiers.",
    fix: "Use lowercase letters, digits and underscores, starting with a letter.",
  },
  storeTableDuplicate: {
    id: "store-table/duplicate",
    summary: "Store table names are unique per feature.",
    fix: "Rename one of the store tables.",
  },
  storeTableReadPrefixReserved: {
    id: "store-table/read-prefix-reserved",
    summary: "Store table names do not use the read_ prefix.",
    fix: "Pick an unprefixed name or a distinct prefix such as store_.",
  },
  storeTableMetaNotUnmanaged: {
    id: "store-table/meta-not-unmanaged",
    summary: "r.storeTable() receives table meta with source unmanaged.",
    fix: 'Build the meta with defineUnmanagedTable() or source: "unmanaged".',
  },
  storeTableReasonMissing: {
    id: "store-table/reason-missing",
    summary: "r.storeTable() declares a non-empty options.reason.",
    fix: "Add a reason justifying the audit-trail bypass or declare the data via r.entity().",
  },
  treeActionsTwice: {
    id: "tree-actions/declared-twice",
    summary: "A feature calls r.treeActions() at most once.",
    fix: "Merge the tree actions into a single r.treeActions() call.",
  },
} as const satisfies BootRuleTable;
