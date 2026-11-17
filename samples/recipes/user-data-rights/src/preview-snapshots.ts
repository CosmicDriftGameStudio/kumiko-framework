// Short-lived technical state as an event-sourced entity: streamRetention lets the data-retention
// job prune whole streams whose newest event is older than keepFor, together with their rows.
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const previewSnapshotEntity = createEntity({
  name: "preview-snapshot",
  table: "read_preview_snapshots",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
  streamRetention: { keepFor: "30d" },
});

export const previewSnapshotsFeature = defineFeature("preview-snapshots", (r) => {
  r.entity(previewSnapshotEntity);
  r.writeHandler(
    defineEntityCreateHandler("preview-snapshot", previewSnapshotEntity, {
      access: { roles: ["Admin"] },
    }),
  );
});
