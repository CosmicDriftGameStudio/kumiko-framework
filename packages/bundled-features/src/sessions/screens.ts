import {
  access,
  i18nKey,
  MAX_LIST_LIMIT,
  type ProjectionDetailScreenDefinition,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  SESSION_DETAIL_SCREEN_ID,
  SESSION_LIST_SCREEN_ID,
  SESSION_MINE_SCREEN_ID,
  SessionHandlers,
  SessionQueries,
} from "./constants.ts";
import { SESSION_DEVICE_CELL_COMPONENT } from "./web/constants.ts";

const DEVICE_RENDERER = { react: { __component: SESSION_DEVICE_CELL_COMPONENT } } as const;

export const createSessionListScreen = (
  adminRoles: readonly string[] = access.admin,
): ProjectionListScreenDefinition => ({
  id: SESSION_LIST_SCREEN_ID,
  type: "projectionList",
  query: SessionQueries.list,
  // The `list` handler honours `limit` only (no offset/total), so a pager would
  // show page 1 forever: send one max-size request and render no pager.
  pagination: false,
  pageSize: MAX_LIST_LIMIT,
  // Mirrors list.query's own fallback (unrecognised/absent sort → createdAt
  // desc) — kept in sync by hand, boot-validator only requires the field
  // be present once the query accepts `sort`.
  defaultSort: { field: "createdAt", dir: "desc" },
  columns: [
    { field: "id", label: i18nKey("sessions.list.col.id") },
    {
      field: "userId",
      label: i18nKey("sessions.list.col.userId"),
      refEntity: "user:user",
      refLabelField: "displayName",
    },
    {
      field: "deviceLabel",
      label: i18nKey("sessions.list.col.device"),
      renderer: DEVICE_RENDERER,
    },
    {
      field: "createdAt",
      label: i18nKey("sessions.list.col.createdAt"),
      renderer: { format: "timestamp" },
    },
    {
      field: "expiresAt",
      label: i18nKey("sessions.list.col.expiresAt"),
      hideOnNarrow: true,
      renderer: { format: "timestamp" },
    },
    {
      field: "revokedAt",
      label: i18nKey("sessions.list.col.revokedAt"),
      hideOnNarrow: true,
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "navigate",
      id: "open",
      label: i18nKey("sessions.list.action.open"),
      screen: SESSION_DETAIL_SCREEN_ID,
      entityId: "id",
      rowClick: true,
    },
  ],
  access: { roles: adminRoles },
});

export const createSessionDetailScreen = (
  adminRoles: readonly string[] = access.admin,
): ProjectionDetailScreenDefinition => ({
  id: SESSION_DETAIL_SCREEN_ID,
  type: "projectionDetail",
  query: SessionQueries.detail,
  listScreenId: SESSION_LIST_SCREEN_ID,
  layout: {
    sections: [
      {
        fields: [
          "id",
          { field: "userId", refEntity: "user:user", refLabelField: "displayName" },
          // The shim (projection-detail-shim.ts) stamps every field as
          // type:"text" — field.renderer is the only way this screen
          // type reaches real per-type formatting instead of a raw ISO
          // string.
          { field: "createdAt", renderer: { format: "timestamp" } },
          { field: "expiresAt", renderer: { format: "timestamp" } },
          { field: "revokedAt", renderer: { format: "timestamp" } },
          { field: "deviceLabel", renderer: DEVICE_RENDERER },
          "ip",
          "userAgent",
        ],
      },
    ],
  },
  fieldLabels: {
    id: i18nKey("sessions.detail.field.id"),
    userId: i18nKey("sessions.detail.field.userId"),
    createdAt: i18nKey("sessions.detail.field.createdAt"),
    expiresAt: i18nKey("sessions.detail.field.expiresAt"),
    revokedAt: i18nKey("sessions.detail.field.revokedAt"),
    deviceLabel: i18nKey("sessions.list.col.device"),
    ip: i18nKey("sessions.detail.field.ip"),
    userAgent: i18nKey("sessions.detail.field.userAgent"),
  },
  access: { roles: adminRoles },
});

// Revoke is hidden on the current session — it would sign the user out mid-click; logout covers it.
export const sessionMineScreen: ProjectionListScreenDefinition = {
  id: SESSION_MINE_SCREEN_ID,
  type: "projectionList",
  description: i18nKey("sessions.mine.description"),
  query: SessionQueries.mine,
  columns: [
    {
      field: "deviceLabel",
      label: i18nKey("sessions.mine.col.userAgent"),
      renderer: DEVICE_RENDERER,
    },
    { field: "ip", label: i18nKey("sessions.mine.col.ip") },
    {
      field: "current",
      label: i18nKey("sessions.mine.col.current"),
      renderer: {
        format: "boolean",
        trueLabel: i18nKey("sessions.mine.current.yes"),
        falseLabel: i18nKey("sessions.mine.current.no"),
      },
    },
    {
      field: "createdAt",
      label: i18nKey("sessions.list.col.createdAt"),
      renderer: { format: "timestamp" },
    },
    {
      field: "expiresAt",
      label: i18nKey("sessions.list.col.expiresAt"),
      hideOnNarrow: true,
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "writeHandler",
      id: "revoke",
      label: i18nKey("sessions.mine.revoke"),
      handler: SessionHandlers.revoke,
      style: "danger",
      confirm: i18nKey("sessions.mine.revoke.confirm"),
      visible: { field: "current", eq: false },
    },
  ],
  toolbarActions: [
    {
      kind: "writeHandler",
      id: "revoke-all-others",
      label: i18nKey("sessions.mine.revokeAllOthers"),
      handler: SessionHandlers.revokeAllOthers,
      style: "danger",
      confirm: i18nKey("sessions.mine.revokeAllOthers.confirm"),
    },
  ],
  access: {
    openToAll: {
      reason:
        "each signed-in user views and revokes only their own sessions, mirroring the mine/revoke handlers",
    },
  },
  // Self-service settings-area screen, placed by the consuming app's own
  // r.nav() — no nav area to resolve in isolation.
  dormant: true,
};
