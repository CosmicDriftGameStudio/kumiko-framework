import {
  DEFAULT_ROW_LEVEL_SECURITY_MODE,
  type RowLevelSecurityMode,
} from "../db/render-rls-ddl.ts";
import { rowLevelSecurityModeOf } from "../db/row-level-security-connection.ts";
import type { AppContext } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";

// The mode lives on the connection; the option states what the app config declared.
// A mismatch means the pools were opened for a different mode than the one the
// schema was applied for, which silently drops or over-applies tenant isolation.
export function assertEntrypointRowLevelSecurityMode(
  context: AppContext,
  declared: RowLevelSecurityMode | undefined,
): void {
  // skip: entrypoint has no db to check
  if (context.db === undefined) return;
  const expected = declared ?? DEFAULT_ROW_LEVEL_SECURITY_MODE;
  const actual = rowLevelSecurityModeOf(context.db);
  if (actual !== expected) {
    throw new InternalError({
      message: `Entrypoint rowLevelSecurity is "${expected}" but the database connection runs in "${actual}" mode; open the pools with the same mode`,
      details: { expected, actual },
    });
  }
}
