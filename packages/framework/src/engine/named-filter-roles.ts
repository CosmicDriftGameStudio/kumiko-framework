import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
import type {
  NamedListFilterDef,
  NamedListFilterRef,
} from "@cosmicdrift/kumiko-types/named-list-filters";
import type { EntityListScreenDefinition } from "../ui-types/index.ts";

// Only a plain role rule is serializable; openToAll, anySignedIn and no rule restrict nobody.
function rolesRestrictingNamedFilter(
  access: AccessRule | undefined,
): readonly string[] | undefined {
  if (access === undefined || "openToAll" in access || access.anySignedIn === true) {
    return undefined;
  }
  return access.roles;
}

// `roles` on a ref is framework-owned: an authored value is dropped so a screen cannot widen the
// entity's access rule on the client.
function refWithEntityRoles(
  ref: NamedListFilterRef,
  defs: Readonly<Record<string, NamedListFilterDef>>,
): NamedListFilterRef {
  const { roles: _authored, ...plain } = ref;
  const def = Object.hasOwn(defs, ref.id) ? defs[ref.id] : undefined;
  const roles = rolesRestrictingNamedFilter(def?.access);
  return roles === undefined ? plain : { ...plain, roles };
}

export function projectNamedFilterRoles(
  screen: EntityListScreenDefinition,
  defs: Readonly<Record<string, NamedListFilterDef>> | undefined,
): EntityListScreenDefinition {
  if (screen.namedFilters === undefined) return screen;
  return {
    ...screen,
    namedFilters: screen.namedFilters.map((ref) => refWithEntityRoles(ref, defs ?? {})),
  };
}
