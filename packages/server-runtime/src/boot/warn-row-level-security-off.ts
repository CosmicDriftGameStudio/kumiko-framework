import type { RowLevelSecurityMode } from "@cosmicdrift/kumiko-framework/db";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";

export function warnIfRowLevelSecurityOff(
  mode: RowLevelSecurityMode,
  log: Pick<Logger, "warn">,
): void {
  // skip: the default mode needs no warning
  if (mode !== "off") return;
  log.warn(
    "rowLevelSecurity is off: tenant isolation relies on the application layer only; Postgres row level security is not enforced",
  );
}
