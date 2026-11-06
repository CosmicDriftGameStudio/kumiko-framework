/// <reference types="temporal-polyfill/global" preserve="true" />
import type { AccessRule, HandlerContext, SessionUser } from "./handlers.ts";

export type NamedListFilterOp = "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";

export type NamedListFilterCondition = {
  readonly field: string;
  readonly op: NamedListFilterOp;
  readonly value: unknown;
};

export type NamedListFilterScope = {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly now: Temporal.Instant;
};

/** A work-queue rule defined once on the entity: the list and every count query resolve the same conditions. */
export type NamedListFilterDef = {
  readonly access?: AccessRule;
  readonly filters: (
    scope: NamedListFilterScope,
  ) => readonly NamedListFilterCondition[] | Promise<readonly NamedListFilterCondition[]>;
};

export type ListSortDir = "asc" | "desc";
export type ListSortSpec = {
  readonly field: string;
  readonly dir: ListSortDir;
};

/** One entry of a list's "Sorted by" select; `label` is an i18n key. */
export type ListSortOption = ListSortSpec & { readonly label: string };

/** Screen-side reference to an entity-defined named filter; `label` is an i18n key. */
export type NamedListFilterRef = {
  readonly id: string;
  readonly label: string;
  /** Order while this filter is active and the URL carries no sort of its own; wins over `defaultSort`. */
  readonly sort?: ListSortSpec;
  /** Select display: draws a divider line below this entry in the dropdown. */
  readonly separatorAfter?: boolean;
  /**
   * Shown instead of the generic "no matches" text when this filter yields an empty list and no
   * search term is set; `title` and `description` are i18n keys. `paramsQuery` (a registered query
   * QN, called without payload) runs only while the empty state is on screen; its result object
   * becomes the translation params of `description`. Without data (loading, error, no result) the
   * description is not rendered.
   */
  readonly emptyState?: {
    readonly title: string;
    readonly description?: string;
    readonly paramsQuery?: string;
  };
  /** Set by the framework from the entity filter's role rule; the chip is offered only to users holding one of them. */
  readonly roles?: readonly string[];
};

/** How the named filters appear in the toolbar: toggle chips (default) or one single-choice select. */
export type NamedFilterFacetOptions = {
  readonly display?: "chips" | "select";
  /** Ask the list query for each filter's hit count and show it next to the label. */
  readonly showCounts?: boolean;
  /** Select entries with zero hits are left out (the active one and "all" stay). Asks for the counts like `showCounts` does, without showing the number unless `showCounts` is set. */
  readonly hideEmpty?: boolean;
  /** "behind-filter": the select opens behind the filter icon next to the search field instead of standing as a pill. Only below `sm`; otherwise it stays a pill. */
  readonly narrowPlacement?: "behind-filter";
  /** i18n key for the select's label, e.g. "To do". */
  readonly label?: string;
};
