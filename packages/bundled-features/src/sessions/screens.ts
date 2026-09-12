import {
  access,
  i18nKey,
  type ProjectionDetailScreenDefinition,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { SESSION_DETAIL_SCREEN_ID, SESSION_LIST_SCREEN_ID, SessionQueries } from "./constants";

const listAccess = { roles: access.admin };

export const sessionListScreen: ProjectionListScreenDefinition = {
  id: SESSION_LIST_SCREEN_ID,
  type: "projectionList",
  query: SessionQueries.list,
  // Mirrors list.query's own fallback (unrecognised/absent sort → createdAt
  // desc) — kept in sync by hand, boot-validator only requires the field
  // be present once the query accepts `sort` (fw#2230).
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
      field: "createdAt",
      label: i18nKey("sessions.list.col.createdAt"),
      renderer: { format: "timestamp" },
    },
    {
      field: "expiresAt",
      label: i18nKey("sessions.list.col.expiresAt"),
      renderer: { format: "timestamp" },
    },
    {
      field: "revokedAt",
      label: i18nKey("sessions.list.col.revokedAt"),
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
  access: listAccess,
};

export const sessionDetailScreen: ProjectionDetailScreenDefinition = {
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
          // string (fw#2245).
          { field: "createdAt", renderer: { format: "timestamp" } },
          { field: "expiresAt", renderer: { format: "timestamp" } },
          { field: "revokedAt", renderer: { format: "timestamp" } },
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
    ip: i18nKey("sessions.detail.field.ip"),
    userAgent: i18nKey("sessions.detail.field.userAgent"),
  },
  access: listAccess,
};
