import type { EntityDefinition } from "./fields";
import type {
  AccessRule,
  AgentHandlerHints,
  EscapeHatchDeclaration,
  QueryHandlerDef,
  WriteHandlerDef,
} from "./handlers";

export type EntityHandlerOptions = {
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  /** Lifts row filtering for this ONE handler across every tenant instead of
   *  the caller's own — for a SystemAdmin-only operator handler over an
   *  otherwise tenant-scoped entity. Every use reports an
   *  `acknowledge-cross-tenant` escape-hatch audit event. On write handlers
   *  update/delete/restore address the target row's own tenant stream.
   *  `access` stays the only caller gate. Unlike `escapeHatch` on a
   *  hand-written handler this does NOT grant `ctx.db.unsafeRaw`,
   *  `db.global()` writes or identity switches. */
  readonly escapeHatch?: EscapeHatchDeclaration;
  /** @deprecated Use `escapeHatch: { reason }` — removed in a future release;
   *  run `scripts/codemod/migrate-cross-tenant.ts`. */
  readonly crossTenant?: boolean;
};

export type EntityQueryHandlerOptions = EntityHandlerOptions;

export type EntityCrudVerb = "create" | "update" | "delete" | "restore" | "list" | "detail";

// `access` stays optional here — registerEntityCrud resolves it per-verb from `verbAccess`, falling back to this default.
export type EntityCrudHandlerDefaults = Omit<EntityHandlerOptions, "access"> & {
  readonly access?: AccessRule;
};

export type RegisterEntityCrudOptions = {
  readonly write?: EntityCrudHandlerDefaults;
  readonly read?: EntityCrudHandlerDefaults;
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
