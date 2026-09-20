import type {
  AccessRule,
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isOpenToAllGranted } from "@cosmicdrift/kumiko-framework/ui-types";
import { lastSegment } from "./qn";

// Minimal role-gate for the screen-render path (#1203 — nav filtering via
// filterByAccess in workspace-shell.tsx hid role-gated screens from the
// menu, but a direct URL/screenQn hit reached KumikoScreen unchecked).
// Reimplemented instead of imported from framework/engine's hasAccess
// (pulls server-side deps) — same bundle-purity reasoning as headless/nav's
// resolve.ts:userCanSee, which this mirrors. Own leaf module (not exported
// from kumiko-screen.tsx directly) so render-field.tsx can import it too
// without the kumiko-screen → RenderEdit → RenderField cycle.
export function screenAccessAllows(
  access: AccessRule | undefined,
  userRoles: readonly string[] | undefined,
): boolean {
  if (!access) return true;
  if ("openToAll" in access) return isOpenToAllGranted(access);
  if (userRoles === undefined) return false;
  return access.roles.some((role) => userRoles.includes(role));
}

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
  for (const feature of appFeatures) {
    for (const candidate of feature.screens) {
      const isTarget =
        entity !== undefined
          ? candidate.detailFor === entity
          : lastSegment(candidate.id) === screen;
      // First match IS the destination: short ids are globally unique
      // (validateScreenShortIdCollisions) and both the router and
      // resolveTarget take the first hit.
      if (isTarget) return screenAccessAllows(candidate.access, userRoles);
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
        s.type === "entityEdit" && s.entity === entity && screenAccessAllows(s.access, userRoles),
    );
    if (match !== undefined) return match;
  }
  return undefined;
}
