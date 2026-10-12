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

// Falls back to the precedence-only primary so an icon action (the pencil)
// stays visible when the declared primary action needs a confirm dialog.
export function compactHeaderIconAction(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): RenderEditAction | undefined {
  const candidates = [primaryHeaderAction(actions, preferredId), primaryHeaderAction(actions)];
  return candidates.find(canStandAsIconButton);
}

export function orderPlainHeaderActions(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): readonly RenderEditAction[] {
  const preferred =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  return preferred === undefined ? actions : [preferred, ...actions.filter((a) => a !== preferred)];
}
