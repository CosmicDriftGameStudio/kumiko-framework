import type { EntityDefinition } from "./fields";
import type { AccessRule, AgentHandlerHints, QueryHandlerDef, WriteHandlerDef } from "./handlers";

export type EntityHandlerOptions = {
  readonly access?: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  /** Reads and writes across every tenant instead of the caller's own — for a
   *  SystemAdmin-only operator handler over an otherwise tenant-scoped entity.
   *  Scope this to the ONE handler that needs it rather than making the whole
   *  feature r.systemScope(), which would drop tenant isolation from every
   *  other handler the feature registers too. This only lifts row filtering;
   *  who may call the handler at all stays gated by `access`.
   *
   *  On write handlers it additionally addresses the event stream by the
   *  target row's tenant instead of the acting user's, so update/delete/
   *  restore hit the row's own stream. `create` has no target row and stays
   *  on the acting user's tenant. On write handlers this also satisfies
   *  entity write-ownership rules that compare against the acting user's
   *  tenant, so `access` is the only remaining gate — grant it to operator
   *  roles only. */
  readonly crossTenant?: boolean;
};

export type EntityQueryHandlerOptions = EntityHandlerOptions;

export type EntityCrudVerb = "create" | "update" | "delete" | "restore" | "list" | "detail";

export type RegisterEntityCrudOptions = {
  readonly write?: EntityHandlerOptions;
  readonly read?: EntityQueryHandlerOptions;
  readonly verbs?: Partial<Record<EntityCrudVerb, boolean>>;
  /** Per-verb access override — falls back to `write.access`/`read.access` when unset for a verb. */
  readonly verbAccess?: Partial<Record<EntityCrudVerb, AccessRule>>;
  /** Per-verb `description` — the author writes one sentence per verb; the AI-agent
   *  manifest exposes only the verbs described here (fail-closed, same rule as
   *  hand-written handlers). Falls back to `write.description`/`read.description`. */
  readonly descriptions?: Partial<Record<EntityCrudVerb, string>>;
  /** Default true. Set false when the entity was already registered (e.g. before r.relation). */
  readonly registerEntity?: boolean;
};

/** Minimal registrar surface — keeps entity-handlers free of define-feature imports. */
export type EntityCrudRegistrar = {
  entity(name: string, definition: EntityDefinition): unknown;
  writeHandler(def: WriteHandlerDef): unknown;
  queryHandler(def: QueryHandlerDef): unknown;
};
