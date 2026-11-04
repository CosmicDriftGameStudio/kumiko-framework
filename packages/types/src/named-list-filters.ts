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
  /** Shown instead of the generic "no matches" text when this filter yields an empty list and no search term is set; both are i18n keys. */
  readonly emptyState?: { readonly title: string; readonly description?: string };
  /** Set by the framework from the entity filter's role rule; the chip is offered only to users holding one of them. */
  readonly roles?: readonly string[];
};

/** How the named filters appear in the toolbar: toggle chips (default) or one single-choice select. */
export type NamedFilterFacetOptions = {
  readonly display?: "chips" | "select";
  /** Ask the list query for each filter's hit count and show it next to the label. */
  readonly showCounts?: boolean;
  /** i18n key for the select's label, e.g. "To do". */
  readonly label?: string;
};
