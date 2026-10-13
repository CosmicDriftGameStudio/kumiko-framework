import { needsActionConfirm } from "../components/render-edit-action-button.js";
import type { RenderEditAction } from "../components/render-edit-types.js";

// The primary header action always stays a visible text button: the screen's
// declared `primaryAction` if it is visible, else `edit`, else the first
// `style: "primary"` action, else the first action at all.
export function primaryHeaderAction(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): RenderEditAction | undefined {
  const preferred =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  return (
    preferred ??
    actions.find((a) => a.id === "edit") ??
    actions.find((a) => a.style === "primary") ??
    actions[0]
  );
}

// A bare icon for a destructive or confirm-gated action (e.g. "x" for
// terminate) reads as "close", so only plain icon actions may stand alone.
function canStandAsIconButton(action: RenderEditAction | undefined): action is RenderEditAction {
  return action?.icon !== undefined && action.style !== "danger" && !needsActionConfirm(action);
}

export type CompactHeaderPrimary = {
  readonly action: RenderEditAction;
  readonly iconOnly: boolean;
};

// A declared, visible `primaryAction` is always the phone header's button
// (labelled when a bare icon would mislead), so it matches the desktop header
// and `edit` moves into the menu. Without one the pencil-style icon action
// stays visible, falling back to the precedence-only primary.
export function compactHeaderPrimary(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): CompactHeaderPrimary | undefined {
  const declared =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  if (declared !== undefined) return { action: declared, iconOnly: canStandAsIconButton(declared) };
  const iconAction = primaryHeaderAction(actions);
  return canStandAsIconButton(iconAction) ? { action: iconAction, iconOnly: true } : undefined;
}

export function orderPlainHeaderActions(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): readonly RenderEditAction[] {
  const preferred =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  return preferred === undefined ? actions : [preferred, ...actions.filter((a) => a !== preferred)];
}
