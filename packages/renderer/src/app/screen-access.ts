import type {
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isUiAccessGranted } from "@cosmicdrift/kumiko-framework/ui-types";
import { findDetailForScreen } from "./nav.js";
import { lastSegment } from "./qn.js";

// Shared UI-visibility predicate for the screen-render path (#1203 — nav
// filtering via filterByAccess in workspace-shell.tsx hid role-gated
// screens from the menu, but a direct URL/screenQn hit reached
// KumikoScreen unchecked). Public name kept as an alias of the shared
// predicate that headless/nav and workspace-shell use as well.
export { isUiAccessGranted as screenAccessAllows };

// A navigate target (metric click) declares no access rule of its own — the
// destination screen already does, so the jump is offered exactly when the
// user may open where it lands (solon#424). No second copy of the rule to
// drift from the screen's own.
export function navigateTargetAllows(
  navigate: { readonly screen?: string; readonly entity?: string },
  appFeatures: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
): boolean {
  const { screen, entity } = navigate;
  // Neither set — stays on the current screen (tab switch), already allowed.
  if (screen === undefined && entity === undefined) return true;
  // KumikoScreen rendered outside createKumikoApp has no screen registry to
  // resolve against; gating on an empty one would hide every jump, not the
  // forbidden ones.
  if (appFeatures.length === 0) return true;
  // Entity targets share nav's lookup so the gate and resolveTarget can't
  // pick different screens. Short ids are globally unique
  // (validateScreenShortIdCollisions), so the first screen hit is the one.
  if (entity !== undefined) {
    const found = findDetailForScreen(appFeatures, entity);
    if (found !== undefined) return isUiAccessGranted(found.screen.access, userRoles);
  } else {
    for (const feature of appFeatures) {
      const candidate = feature.screens.find((s) => lastSegment(s.id) === screen);
      if (candidate !== undefined) return isUiAccessGranted(candidate.access, userRoles);
    }
  }
  // Unresolvable target — the boot-validator doesn't check metric navigate
  // targets, so this is a typo'd dead jump. Don't offer it.
  return false;
}

// Searches all mounted features, and access is part of the predicate so a
// role-gated first match can't hide an accessible second one.
export function findEditScreenFor(
  entity: string,
  appFeatures: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
): EntityEditScreenDefinition | undefined {
  for (const feature of appFeatures) {
    const match = feature.screens.find(
      (s): s is EntityEditScreenDefinition =>
        s.type === "entityEdit" && s.entity === entity && isUiAccessGranted(s.access, userRoles),
    );
    if (match !== undefined) return match;
  }
  return undefined;
}
