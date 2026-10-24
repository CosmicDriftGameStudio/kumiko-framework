import type { AnyFileFieldDef } from "@cosmicdrift/kumiko-types/fields";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { hasAccess } from "../engine/access.ts";
import { isFileField } from "../engine/field-helpers.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";

// Same character set as the other upload identifiers: the screen QN is stored as the pending
// upload's entityType and compared by exact match, never interpolated into a storage key.
const ACTION_FORM_SCREEN_QN = /^[A-Za-z0-9_-]+:screen:[A-Za-z0-9_-]+$/;

export function isActionFormScreenQn(value: string): boolean {
  return ACTION_FORM_SCREEN_QN.test(value);
}

function findActionFormScreen(
  registry: Pick<Registry, "getScreen">,
  screenQn: string,
): ActionFormScreenDefinition | undefined {
  if (!isActionFormScreenQn(screenQn)) return undefined;
  const screen = registry.getScreen(screenQn);
  return screen?.type === "actionForm" ? screen : undefined;
}

/** The files/images field `fieldName` of the registered actionForm screen `screenQn`, if any. */
export function resolveActionFormFileField(
  registry: Pick<Registry, "getScreen"> | undefined,
  screenQn: string,
  fieldName: string,
): AnyFileFieldDef | undefined {
  const screen = registry && findActionFormScreen(registry, screenQn);
  const field = screen?.fields[fieldName];
  return field !== undefined && isFileField(field) ? field : undefined;
}

export type ActionFormFileField = {
  readonly screenQn: string;
  readonly fieldName: string;
  readonly fieldDef: AnyFileFieldDef;
};

export function listActionFormFileFields(
  registry: Pick<Registry, "getAllScreens"> | undefined,
): readonly ActionFormFileField[] {
  const found: ActionFormFileField[] = [];
  for (const [screenQn, screen] of registry?.getAllScreens() ?? []) {
    if (screen.type !== "actionForm") continue;
    for (const [fieldName, fieldDef] of Object.entries(screen.fields)) {
      if (isFileField(fieldDef)) found.push({ screenQn, fieldName, fieldDef });
    }
  }
  return found;
}

/**
 * Whether `user` may submit the actionForm `screenQn`: the screen's own access (when set) and
 * the access of its handler must both pass, so an upload is never accepted for a form the
 * caller could not submit.
 */
export function mayUseActionForm(
  registry: Pick<Registry, "getScreen" | "getWriteHandler">,
  screenQn: string,
  user: Pick<SessionUser, "roles">,
): boolean {
  const screen = findActionFormScreen(registry, screenQn);
  if (screen === undefined) return false;
  if (screen.access !== undefined && !hasAccess(user, screen.access)) return false;
  return hasAccess(user, registry.getWriteHandler(screen.handler)?.access);
}
