import { LIST_NARROW_FACETS } from "@cosmicdrift/kumiko-types/screen";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { bootRuleError } from "./boot-rule.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";

const TOOLBAR_ACTIONS_PLACEMENTS = ["header", "toolbar"] as const;

type ListToolbarOptionScreen = {
  readonly toolbarSort?: true;
  readonly narrowFacets?: unknown;
  readonly sortOptions?: readonly unknown[];
  readonly toolbarActionsPlacement?: unknown;
  readonly toolbarActions?: readonly unknown[];
};

/** Toolbar options shared by entityList and projectionList. */
export function validateListToolbarOptions(where: string, screen: ListToolbarOptionScreen): void {
  if (screen.toolbarSort === true && (screen.sortOptions ?? []).length === 0) {
    throw bootRuleError(SCREEN_KIND_RULES.toolbarSortWithoutSortOptions, {
      message: `${where} sets toolbarSort without sortOptions — the select lists the sortOptions. Declare sortOptions or remove toolbarSort.`,
    });
  }
  if (screen.narrowFacets !== undefined && !isOneOf(LIST_NARROW_FACETS, screen.narrowFacets)) {
    throw bootRuleError(SCREEN_KIND_RULES.narrowFacetsInvalid, {
      message: `${where} sets narrowFacets ${JSON.stringify(screen.narrowFacets)} — must be "pills".`,
    });
  }
  const placement = screen.toolbarActionsPlacement;
  if (placement === undefined) return;
  if (!isOneOf(TOOLBAR_ACTIONS_PLACEMENTS, placement)) {
    throw bootRuleError(SCREEN_KIND_RULES.toolbarActionsPlacementInvalid, {
      message: `${where} sets toolbarActionsPlacement ${JSON.stringify(placement)} — must be "header" or "toolbar".`,
    });
  }
  if (placement === "toolbar" && (screen.toolbarActions ?? []).length === 0) {
    throw bootRuleError(SCREEN_KIND_RULES.toolbarActionsPlacementWithoutActions, {
      message: `${where} sets toolbarActionsPlacement "toolbar" without toolbarActions — there is nothing to place. Declare toolbarActions or remove toolbarActionsPlacement.`,
    });
  }
}
