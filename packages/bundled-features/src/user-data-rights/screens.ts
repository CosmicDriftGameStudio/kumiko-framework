import {
  access,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

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
      label: "kumiko.actions.view",
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
  columns: ["attemptedAt", "result", "via", "ip", "attemptedByUserId", "jobId"],
  searchable: false,
  access: { roles: access.systemAdmin },
};
