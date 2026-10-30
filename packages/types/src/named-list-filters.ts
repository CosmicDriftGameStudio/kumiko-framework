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

/** Screen-side reference to an entity-defined named filter; `label` is an i18n key. */
export type NamedListFilterRef = {
  readonly id: string;
  readonly label: string;
};
