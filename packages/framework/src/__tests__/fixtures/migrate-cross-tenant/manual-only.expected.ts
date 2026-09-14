import {
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineEntityRestoreHandler,
  registerEntityCrud,
} from "../../../engine/entity-handlers";
import { legacyReportEntity } from "./legacy-report.entity";
import { widgetEntity } from "./widget.entity";

const access = { roles: ["SystemAdmin"] };
const someFlag = process.env.WIDGET_CROSS_TENANT === "true";

const sysadminAccess = { access, crossTenant: true };

export function registerWidget(r) {
  r.writeHandler(defineEntityCreateHandler("widget", widgetEntity, { ...sysadminAccess }));

  registerEntityCrud(r, "widget", widgetEntity, {
    write: { access, crossTenant: true },
    read: { access },
  });

  r.writeHandler(
    defineEntityRestoreHandler("widget", widgetEntity, {
      access,
      crossTenant: true,
      escapeHatch: { reason: "legacy grant, needs review" },
    }),
  );

  r.queryHandler(
    defineEntityListHandler("legacy-report", legacyReportEntity, {
      access,
      crossTenant: someFlag,
    }),
  );

  r.queryHandler(
    defineEntityListHandler("widget-summary", widgetEntity, {
      access,
      crossTenant: false,
    }),
  );
}
