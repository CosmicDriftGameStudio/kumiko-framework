import type { EntityDefinition } from "./fields";
import type { AccessRule, QueryHandlerDef, WriteHandlerDef } from "./handlers";

export type EntityHandlerOptions = { readonly access?: AccessRule };

export type EntityQueryHandlerOptions = EntityHandlerOptions & {
  /** Reads across every tenant instead of the caller's own — for a
   *  SystemAdmin-only operator inspector over an otherwise tenant-scoped
   *  entity. Scope this to the ONE handler that needs it rather than making
   *  the whole feature r.systemScope(), which would drop tenant isolation
   *  from every other handler the feature registers too. */
  readonly crossTenant?: boolean;
};

export type EntityCrudVerb = "create" | "update" | "delete" | "restore" | "list" | "detail";

export type RegisterEntityCrudOptions = {
  readonly write?: EntityHandlerOptions;
  readonly read?: EntityQueryHandlerOptions;
  readonly verbs?: Partial<Record<EntityCrudVerb, boolean>>;
  /** Default true. Set false when the entity was already registered (e.g. before r.relation). */
  readonly registerEntity?: boolean;
};

/** Minimal registrar surface — keeps entity-handlers free of define-feature imports. */
export type EntityCrudRegistrar = {
  entity(name: string, definition: EntityDefinition): unknown;
  writeHandler(def: WriteHandlerDef): unknown;
  queryHandler(def: QueryHandlerDef): unknown;
};
