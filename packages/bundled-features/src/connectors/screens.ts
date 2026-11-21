import {
  type ActionFormScreenDefinition,
  access,
  i18nKey,
  MAX_LIST_LIMIT,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ACTION_FORM_ENTITY,
  type CustomScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import {
  CONNECTOR_STATUS,
  CONNECTORS_FEATURE,
  ConnectorHandlers,
  ConnectorQueries,
  ConnectorScreens,
  SYNC_STATUS,
} from "./constants.ts";

export const CONNECTOR_STATUS_OPTION_KEY_PREFIX = "connectors.list.status.";

export const SYNC_STATUS_OPTION_KEY_PREFIX = "connectors.list.sync.status.";

export const connectorFieldLabelKey = (field: string): string =>
  fieldLabelKey(CONNECTORS_FEATURE, ACTION_FORM_ENTITY, field);

const PAIR_ACTION = {
  kind: "navigate",
  id: "pair",
  label: i18nKey("connectors.pair.title"),
  screen: ConnectorScreens.pair,
  style: "primary",
  icon: "plus",
} as const;

const ADMIN_ACCESS = { roles: access.admin } as const;

export const connectorListScreen: ProjectionListScreenDefinition = {
  id: ConnectorScreens.list,
  type: "projectionList",
  agent: { expose: false },
  query: ConnectorQueries.list,
  // The list handler returns every connector without offset or total, so a pager would be inert.
  pagination: false,
  pageSize: MAX_LIST_LIMIT,
  // A handful of paired devices is not worth an export; drops the app-wide default.
  table: { export: undefined },
  columns: [
    { field: "name", label: i18nKey("connectors.list.col.name"), sortable: false },
    {
      field: "status",
      label: i18nKey("connectors.list.col.status"),
      sortable: false,
      renderer: { format: "enumOption", keyPrefix: CONNECTOR_STATUS_OPTION_KEY_PREFIX },
    },
    {
      field: "syncStatus",
      label: i18nKey("connectors.list.col.sync"),
      sortable: false,
      renderer: {
        format: "enumOption",
        keyPrefix: SYNC_STATUS_OPTION_KEY_PREFIX,
        tones: {
          [SYNC_STATUS.unknown]: "neutral",
          [SYNC_STATUS.synced]: "ok",
          [SYNC_STATUS.syncing]: "accent",
          [SYNC_STATUS.failed]: "bad",
        },
      },
    },
    {
      field: "syncDetail",
      label: i18nKey("connectors.list.col.syncDetail"),
      sortable: false,
      hideOnNarrow: true,
      renderer: { format: "i18nText" },
    },
    {
      field: "lastSeenAt",
      label: i18nKey("connectors.list.col.lastSeen"),
      sortable: false,
      renderer: { format: "timestamp", emptyLabel: i18nKey("connectors.list.neverSeen") },
    },
    {
      field: "reportedVersion",
      label: i18nKey("connectors.list.col.version"),
      sortable: false,
      hideOnNarrow: true,
    },
    {
      field: "createdAt",
      label: i18nKey("connectors.list.col.created"),
      sortable: false,
      hideOnNarrow: true,
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "writeHandler",
      id: "revoke",
      label: i18nKey("connectors.list.revoke"),
      handler: ConnectorHandlers.revoke,
      style: "danger",
      confirm: i18nKey("connectors.list.revoke.confirm"),
      visible: { field: "status", ne: CONNECTOR_STATUS.revoked },
    },
    {
      kind: "writeHandler",
      id: "retry",
      label: i18nKey("connectors.list.retry"),
      handler: ConnectorHandlers.requestRetry,
      visible: { field: "syncStatus", eq: SYNC_STATUS.failed },
    },
  ],
  toolbarActions: [PAIR_ACTION],
  emptyState: {
    title: i18nKey("connectors.list.empty.title"),
    description: i18nKey("connectors.list.empty.hint"),
    action: PAIR_ACTION,
  },
  access: ADMIN_ACCESS,
  // Placed by the consuming app's own r.nav(), like the personal-access-token screens.
  dormant: true,
};

const PENDING_REQUEST_PREVIEW = {
  query: ConnectorQueries.pendingRequest,
  fields: ["userCode"],
  title: i18nKey("connectors.pair.request.title"),
  section: "request",
  facts: [
    { field: "requestedAt", label: i18nKey("connectors.pair.request.at"), type: "timestamp" },
    { field: "requestIp", label: i18nKey("connectors.pair.request.ip") },
    {
      field: "requestIpLocal",
      label: i18nKey("connectors.pair.request.ipNote"),
      valueIsI18nKey: true,
    },
  ],
} as const;

const USER_CODE_FIELD = { type: "text", required: true, maxLength: 32 } as const;

// Step one: only checks that the code belongs to an open request, then hands it to the confirm step.
export const connectorPairScreen: ActionFormScreenDefinition = {
  id: ConnectorScreens.pair,
  type: "actionForm",
  agent: { expose: false },
  handler: ConnectorHandlers.checkDevice,
  linkPrefillFields: ["userCode"],
  submitPrefilled: true,
  fields: { userCode: USER_CODE_FIELD },
  layout: { sections: [{ fields: ["userCode"] }] },
  submitLabel: i18nKey("connectors.pair.check"),
  redirect: {
    screen: ConnectorScreens.confirm,
    searchParams: { userCode: "userCode" },
    handOff: true,
  },
  cancelTarget: ConnectorScreens.list,
  access: ADMIN_ACCESS,
  dormant: true,
};

// Step two: step one seeds the checked code into the URL, but any link can prefill that URL too.
// The server therefore confirms only a code the same admin checked in the last few minutes.
export const connectorConfirmScreen: ActionFormScreenDefinition = {
  id: ConnectorScreens.confirm,
  type: "actionForm",
  agent: { expose: false },
  handler: ConnectorHandlers.approveDevice,
  fields: {
    userCode: USER_CODE_FIELD,
    name: { type: "text", required: true, maxLength: 120 },
  },
  // The request box closes the first section, above the name; the checked code stays visible there, read-only.
  layout: {
    sections: [
      { id: "request", fields: [{ field: "userCode", readOnly: true }] },
      { fields: ["name"] },
    ],
  },
  preview: PENDING_REQUEST_PREVIEW,
  valueDisplay: "text",
  listScreenId: ConnectorScreens.list,
  submitLabel: i18nKey("connectors.pair.submit"),
  redirect: ConnectorScreens.list,
  cancelTarget: ConnectorScreens.list,
  access: ADMIN_ACCESS,
  dormant: true,
};

// The file tree needs breadcrumb navigation inside one screen, which no generated list screen
// offers; the web client plugin mounts the component under this id.
export const connectorFilesScreen: CustomScreenDefinition = {
  id: ConnectorScreens.files,
  type: "custom",
  renderer: { react: { __component: ConnectorScreens.files } },
  description:
    "The files the connectors delivered as a folder tree: breadcrumb, folders with file count and size, the files of the open folder, storage used against the quota, and delete for files and folders.",
  access: ADMIN_ACCESS,
  dormant: true,
};
