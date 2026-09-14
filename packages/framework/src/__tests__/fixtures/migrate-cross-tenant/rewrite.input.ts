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
      crossTenant: true,
      description: "Lists export jobs across every tenant for operator support",
    }),
  );

  r.writeHandler(
    defineEntityUpdateHandler("export-job", exportJobEntity, {
      access,
      crossTenant: true,
    }),
  );

  r.writeHandler(
    defineEntityWriteHandler("note:delete", noteEntity, {
      access,
      crossTenant: true,
    }),
  );

  r.queryHandler(
    defineEntityDetailHandler("export-job", exportJobEntity, {
      access,
      crossTenant: true,
    }),
  );
}
