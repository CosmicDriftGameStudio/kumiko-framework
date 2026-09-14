import {
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineEntityWriteHandler,
} from "../../../engine/entity-handlers";
import { exportJobEntity } from "./export-job.entity";
import { noteEntity } from "./note.entity";

const access = { roles: ["SystemAdmin"] };

export function registerExportJob(r) {
  r.queryHandler(
    defineEntityListHandler("export-job", exportJobEntity, {
      access,
      escapeHatch: { reason: "export-job:list reads export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" },
      description: "Lists export jobs across every tenant for operator support",
    }),
  );

  r.writeHandler(
    defineEntityUpdateHandler("export-job", exportJobEntity, {
      access,
      escapeHatch: { reason: "export-job:update writes export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" },
    }),
  );

  r.writeHandler(
    defineEntityWriteHandler("note:delete", noteEntity, {
      access,
      escapeHatch: { reason: "note:delete writes note rows across every tenant (migrated from crossTenant: true; state the operator use case here)" },
    }),
  );

  r.queryHandler(
    defineEntityDetailHandler("export-job", exportJobEntity, {
      access,
      escapeHatch: { reason: "export-job:detail reads export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" },
    }),
  );
}
