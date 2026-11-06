import type {
  NamedListFilterDef,
  NamedListFilterRef,
} from "@cosmicdrift/kumiko-types/named-list-filters";
import type { EntityListScreenDefinition } from "../ui-types/index.ts";

// `access` on a ref is framework-owned: an authored value is dropped so a screen cannot widen the
// entity filter's access rule on the client. A rule is plain data (roles, openToAll), safe to serialize.
function refWithEntityAccess(
  ref: NamedListFilterRef,
  defs: Readonly<Record<string, NamedListFilterDef>>,
): NamedListFilterRef {
  const { access: _authored, ...plain } = ref;
  const def = Object.hasOwn(defs, ref.id) ? defs[ref.id] : undefined;
  return def?.access === undefined ? plain : { ...plain, access: def.access };
}

export function projectNamedFilterRoles(
  screen: EntityListScreenDefinition,
  defs: Readonly<Record<string, NamedListFilterDef>> | undefined,
): EntityListScreenDefinition {
  if (screen.namedFilters === undefined) return screen;
  return {
    ...screen,
    namedFilters: screen.namedFilters.map((ref) => refWithEntityAccess(ref, defs ?? {})),
  };
}
