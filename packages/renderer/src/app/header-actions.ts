import { needsActionConfirm } from "../components/render-edit-action-button.tsx";
import type { RenderEditAction } from "../components/render-edit-types.ts";

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

// The undeclared fallback picks an action nobody chose for the header, so a
// destructive or confirm-gated one (a bare "x" reads as "close") may not stand alone.
function canStandAsIconButton(action: RenderEditAction | undefined): action is RenderEditAction {
  return action?.icon !== undefined && action.style !== "danger" && !needsActionConfirm(action);
}

export type CompactHeaderPrimary = {
  readonly action: RenderEditAction;
  readonly iconOnly: boolean;
};

// A declared, visible `primaryAction` is always the phone header's button, icon
// only when it has an icon (the author chose the icon, the label is its aria-label),
// so it matches the desktop header and `edit` moves into the menu. Without one the
// pencil-style icon action stays visible, falling back to the precedence-only primary.
export function compactHeaderPrimary(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): CompactHeaderPrimary | undefined {
  const declared =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  if (declared !== undefined) return { action: declared, iconOnly: declared.icon !== undefined };
  const iconAction = primaryHeaderAction(actions);
  return canStandAsIconButton(iconAction) ? { action: iconAction, iconOnly: true } : undefined;
}

export type SplitHeaderActions = {
  readonly buttons: readonly RenderEditAction[];
  readonly menu: readonly RenderEditAction[];
};

// The primary action leads the visible buttons, the declared inline actions follow it,
// everything else goes into the menu.
export function splitHeaderActions(
  actions: readonly RenderEditAction[],
  preferredId?: string,
  inlineIds?: readonly string[],
): SplitHeaderActions {
  const primary = primaryHeaderAction(actions, preferredId);
  const others = actions.filter((action) => action.id !== primary?.id);
  const inline = others.filter((action) => inlineIds?.includes(action.id) === true);
  return {
    buttons: primary === undefined ? inline : [primary, ...inline],
    menu: others.filter((action) => !inline.includes(action)),
  };
}

export function orderPlainHeaderActions(
  actions: readonly RenderEditAction[],
  preferredId?: string,
): readonly RenderEditAction[] {
  const preferred =
    preferredId !== undefined ? actions.find((a) => a.id === preferredId) : undefined;
  return preferred === undefined ? actions : [preferred, ...actions.filter((a) => a !== preferred)];
}
