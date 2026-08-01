import type { AccessRule } from "@cosmicdrift/kumiko-framework/ui-types";

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
  if ("openToAll" in access) return access.openToAll;
  if (userRoles === undefined) return false;
  return access.roles.some((role) => userRoles.includes(role));
}
