import { warnOnUniqueAccessRoles } from "./access-roles.ts";
import type { BootContext } from "./boot-context.ts";
import { warnOnToggleableDependencies } from "./config-deps.ts";
import { warnOnNavAccessInversion, warnOnUnreachableNavScreens } from "./nav.ts";
import { warnOnMissingSecurityBaseline } from "./security-baseline.ts";
import { resolveNavAllowlist } from "./workspaces.ts";

// Warnings only make sense for a valid composition, so they run after every
// validation phase passed.
export function emitBootWarnings(ctx: BootContext): void {
  const { features, options, allNavQns, allWorkspaceQns } = ctx;
  warnOnNavAccessInversion(allNavQns);
  const effectiveNavAllowlist = resolveNavAllowlist(
    options?.navAllowlist,
    allNavQns,
    allWorkspaceQns,
  );
  if (effectiveNavAllowlist !== undefined) {
    warnOnUnreachableNavScreens(
      allNavQns,
      effectiveNavAllowlist,
      options?.navAllowlistExempt,
      options?.navAllowlist === undefined ? "workspaces" : "explicit",
    );
  }
  warnOnToggleableDependencies(features, ctx.featureMap);
  warnOnMissingSecurityBaseline(features);
  if (options?.warnOnUniqueAccessRoles === true) {
    warnOnUniqueAccessRoles(features);
  }
}
