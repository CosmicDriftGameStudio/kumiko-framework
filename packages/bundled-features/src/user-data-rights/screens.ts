import {
  access,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  i18nKey,
  type ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  EXPORT_SECTION_EXTENSION_NAME,
  PRIVACY_CENTER_SCREEN_ID,
  STATUS_OPTION_KEY_PREFIX,
  USER_ME_QUERY,
  UserDataRightsHandlers,
} from "./web/constants.ts";

// Read-only operator inspector for the GDPR data-rights read-models. All
// screens are SystemAdmin-gated and inert until an app navs them — the feature
// only registers them, the app opts in per screen via r.nav (see the
// mount-inspector-screens guide). The entities are event-sourced r.entity rows,
// so binding entityList/entityEdit to them is safe (no direct-write rebuild
// hazard like jobs/sessions).

// Read-only field shorthand for the detail screens — every field is display-only.
const ro = (field: string) => ({ field, readOnly: true });

export const exportJobListScreen: EntityListScreenDefinition = {
  id: "export-job-list",
  type: "entityList",
  entity: "export-job",
  columns: ["userId", "status", "requestedAt", "completedAt", "expiresAt"],
  rowActions: [
    {
      kind: "navigate",
      id: "view",
      label: i18nKey("kumiko.actions.view"),
      screen: "export-job-detail",
      entityId: "id",
    },
  ],
  defaultSort: { field: "requestedAt", dir: "desc" },
  searchable: true,
  access: { roles: access.systemAdmin },
};

export const exportJobDetailScreen: EntityEditScreenDefinition = {
  id: "export-job-detail",
  type: "entityEdit",
  entity: "export-job",
  layout: {
    sections: [
      {
        columns: 2,
        fields: [
          ro("userId"),
          ro("requestedFromTenantId"),
          ro("status"),
          ro("requestedAt"),
          ro("startedAt"),
          ro("completedAt"),
          ro("expiresAt"),
          ro("downloadStorageKey"),
          ro("bytesWritten"),
          ro("errorMessage"),
        ],
      },
    ],
  },
  // Inspector is strictly read-only: no export-job:create/update/delete handler
  // exists, and the export lifecycle is driven by the worker, not an operator.
  allowCreate: false,
  allowDelete: false,
  access: { roles: access.systemAdmin },
};

export const downloadAttemptListScreen: EntityListScreenDefinition = {
  id: "download-attempt-list",
  type: "entityList",
  entity: "download-attempt",
  columns: [
    "attemptedAt",
    "result",
    "via",
    "ip",
    { field: "attemptedByUserId", hideOnNarrow: true },
    { field: "jobId", hideOnNarrow: true },
  ],
  searchable: false,
  access: { roles: access.systemAdmin },
  // Inert until an app navs it (see file header) — no nav area to resolve
  // in isolation.
  dormant: true,
};

// Duplicated in web/default-translations.ts: privacy-center-screen.tsx renders them client-side.
export const PRIVACY_CENTER_TRANSLATIONS = {
  "userDataRights.privacyCenter.field.status": { en: "Account status" },
  "userDataRights.privacyCenter.field.gracePeriodEnd": { en: "Scheduled deletion date" },
  "userDataRights.privacyCenter.export.title": { en: "Export your data (Art. 20)" },
  "userDataRights.privacyCenter.restriction.title": { en: "Restrict processing (Art. 18)" },
  "userDataRights.privacyCenter.restriction.explainer": {
    en: "Freeze your account: processing of your data is paused and you are signed out. Lifting the restriction afterwards is only possible via support.",
  },
  "userDataRights.privacyCenter.restriction.restrict": { en: "Restrict account" },
  "userDataRights.privacyCenter.restriction.dialogTitle": { en: "Restrict your account?" },
  "userDataRights.privacyCenter.restriction.dialogDescription": {
    en: "You will be signed out immediately and cannot sign in again until support lifts the restriction.",
  },
  "userDataRights.privacyCenter.deletion.title": { en: "Delete account (Art. 17)" },
  "userDataRights.privacyCenter.deletion.explainer": {
    en: "Request deletion of your account. Until the grace period ends you can cancel the deletion.",
  },
  "userDataRights.privacyCenter.deletion.delete": { en: "Delete account" },
  "userDataRights.privacyCenter.deletion.cancel": { en: "Cancel deletion" },
  "userDataRights.privacyCenter.deletion.dialogTitle": { en: "Delete your account?" },
  "userDataRights.privacyCenter.deletion.dialogDescription": {
    en: "Confirming starts the deletion grace period. You can cancel the deletion until it ends.",
  },
};

// Self-service Art. 15/17/18/20 on the caller's own `me` row; no r.nav (dormant), handlers enforce auth.
// Export stays a custom extension section (web/client-plugin.tsx): it needs job polling and a signed-URL download.
export function privacyCenterScreen(showDeletion: boolean): ProjectionDetailScreenDefinition {
  return {
    id: PRIVACY_CENTER_SCREEN_ID,
    type: "projectionDetail",
    query: USER_ME_QUERY,
    singleton: true,
    access: {
      openToAll: {
        reason:
          "each signed-in user manages GDPR self-service actions (export, restriction, " +
          "deletion) for only their own account; the bound query and every action handler " +
          "operate on the caller's own userId, and no app role name is portable enough to gate this",
      },
    },
    dormant: true,
    description: showDeletion
      ? "userDataRights.privacyCenter.subtitle"
      : "userDataRights.privacyCenter.subtitleWithoutDeletion",
    fieldLabels: {
      status: i18nKey("userDataRights.privacyCenter.field.status"),
      gracePeriodEnd: i18nKey("userDataRights.privacyCenter.field.gracePeriodEnd"),
    },
    layout: {
      sections: [
        {
          kind: "extension",
          title: i18nKey("userDataRights.privacyCenter.export.title"),
          component: { react: { __component: EXPORT_SECTION_EXTENSION_NAME } },
          entityName: "export-job",
        },
        {
          // `status` lives here (not in Deletion) because this is the one
          // section always on the screen — Deletion is dropped entirely
          // when `showDeletion` is false, and status covers restriction
          // AND deletion state, so it can't hang off the optional section.
          title: i18nKey("userDataRights.privacyCenter.restriction.title"),
          description: i18nKey("userDataRights.privacyCenter.restriction.explainer"),
          fields: [
            {
              field: "status",
              renderer: { format: "enumOption", keyPrefix: STATUS_OPTION_KEY_PREFIX },
            },
          ],
          actions: [
            {
              id: "restrict",
              icon: "lock",
              label: i18nKey("userDataRights.privacyCenter.restriction.restrict"),
              handler: UserDataRightsHandlers.restrictAccount,
              confirm: i18nKey("userDataRights.privacyCenter.restriction.dialogDescription"),
              visible: { field: "status", ne: "restricted" },
              style: "secondary",
            },
          ],
        },
        ...(showDeletion
          ? [
              {
                title: i18nKey("userDataRights.privacyCenter.deletion.title"),
                description: i18nKey("userDataRights.privacyCenter.deletion.explainer"),
                // gracePeriodEnd is only meaningful once a deletion is
                // actually pending — hide it instead of showing an empty
                // date when status isn't deletionRequested.
                fields: [
                  {
                    field: "gracePeriodEnd",
                    renderer: { format: "date" as const },
                    visible: { field: "status", eq: "deletionRequested" },
                  },
                ],
                actions: [
                  {
                    id: "request-deletion",
                    label: i18nKey("userDataRights.privacyCenter.deletion.delete"),
                    handler: UserDataRightsHandlers.requestDeletion,
                    confirm: i18nKey("userDataRights.privacyCenter.deletion.dialogDescription"),
                    visible: { field: "status", ne: "deletionRequested" },
                    style: "danger" as const,
                  },
                  {
                    id: "cancel-deletion",
                    label: i18nKey("userDataRights.privacyCenter.deletion.cancel"),
                    handler: UserDataRightsHandlers.cancelDeletion,
                    visible: { field: "status", eq: "deletionRequested" },
                    style: "secondary" as const,
                    // Declared: the id's last segment ("deletion") would otherwise resolve to the destructive trash icon.
                    icon: "x" as const,
                  },
                ],
              },
            ]
          : []),
      ],
    },
  };
}
