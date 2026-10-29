// Inspection Checklist Sample
// Shows: an embedded list as a phone inspection checklist.
//   - visibleWhen / requiredWhen on cells and top-level fields (server-enforced)
//   - a derived pass/fail cell (inRange) that the server recomputes
//   - an images cell per row, uploaded with the `subField` multipart part
//   - fixed rows copied from a plan, only the result cells stay editable

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { inspectionPlanEntity } from "./entities/inspection-plan";
import { inspectionProtocolEntity } from "./entities/inspection-protocol";
import { createFromPlan } from "./handlers/create-from-plan.write";
import { inspectionProtocolEditScreen } from "./screens/inspection-protocol-edit.screen";

export { inspectionPlanEntity } from "./entities/inspection-plan";
export { inspectionProtocolEntity } from "./entities/inspection-protocol";

const inspectorAccess = { access: { roles: ["Admin", "Inspector"] } } as const;

export const inspectionChecklistFeature = defineFeature("inspection-checklist", (r) => {
  r.requires({ features: ["files"] });

  r.crud("inspection-plan", inspectionPlanEntity, {
    write: inspectorAccess,
    read: inspectorAccess,
  });
  r.crud("inspection-protocol", inspectionProtocolEntity, {
    write: inspectorAccess,
    read: inspectorAccess,
  });
  r.writeHandler(createFromPlan);

  r.screen(inspectionProtocolEditScreen);
});
