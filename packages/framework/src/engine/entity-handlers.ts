import {
  type DeriveContext,
  type EntityDefinition,
  isSqlDerivedField,
} from "@cosmicdrift/kumiko-types/fields";
import type {
  AccessRule,
  AgentHandlerHints,
  EscapeHatchDeclaration,
  QueryHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-types/handlers";
import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import {
  type ListAggregatePayload,
  listAggregatePayloadSchema,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import type { NamedListFilterCondition } from "@cosmicdrift/kumiko-types/named-list-filters";
import type { ZodType } from "zod";
import * as z from "zod";
import type { DbRow } from "../db/connection.ts";
import {
  collectReferenceFields,
  enrichRowWithReferences,
  enrichWithReferences,
} from "../db/eagerload.ts";
import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor.ts";
import { answerListAggregate } from "../db/list-aggregate-labels.ts";
import { buildEntityTable, type EntityRow, type EntityTable } from "../db/table-builder.ts";
import {
  acknowledgeConventionCrossTenant,
  reportConventionCrossTenantUse,
  type TenantDb,
} from "../db/tenant-db.ts";
import { InternalError } from "../errors/index.ts";
import { isSystemIdentity } from "../pipeline/system-identity-switch.ts";
import { assertUnreachable } from "../utils/index.ts";
import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { DEFINITION_HANDLER_RULES } from "./boot-validator/definition-handlers-rules.ts";
import { PAGED_QUERY_HANDLER_BRAND } from "./define-handler.ts";
import { entityListRuntime, parentVisibilityFor } from "./entity-list-runtime-options.ts";
import { assertReason } from "./escape-hatch-reason.ts";
import { dropEmptyWriteOnlyValues } from "./field-access.ts";
import { instructionFieldNames } from "./instruction-fields.ts";
import { resolveNamedListFilters } from "./resolve-named-list-filters.ts";
import { buildInsertSchema, buildUpdateSchema } from "./schema-builder.ts";
import type {
  EntityCrudRegistrar,
  EntityCrudVerb,
  EntityHandlerOptions,
  EntityQueryHandlerOptions,
  EntityWriteHandlerOptions,
  RegisterEntityCrudOptions,
} from "./types/entity-handlers.ts";
import { parseTenantId, type TenantId } from "./types/identifiers.ts";
import type { HandlerContext, SessionUser } from "./types/index.ts";

export type {
  EntityCrudHandlerDefaults,
  EntityCrudRegistrar,
  EntityCrudVerb,
  EntityHandlerOptions,
  EntityQueryHandlerOptions,
  EntityWriteHandlerOptions,
  RegisterEntityCrudOptions,
} from "./types/entity-handlers.ts";

// Convention-based handler factories for event-sourced aggregates.
//
// You register one handler per call (no auto-generation of a whole CRUD set),
// but the Schema and the executor body are inferred from the entity + verb.
// Pick the verbs you need — leave out the ones you don't.
//
// Two API shapes — pick one per project, don't mix:
//
//   PREFERRED — full standard CRUD set in one call:
//     r.crud("note", noteEntity, { write: { access }, read: { access } })
//
//   PREFERRED — one function per verb, type-safe, no magic strings:
//     r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access }))
//     r.writeHandler(defineEntityUpdateHandler("note", noteEntity, { access }))
//     r.writeHandler(defineEntityDeleteHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityListHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access }))
//
//   LEGACY — single function with verb in the name-string. Kept for
//   backwards-compat; existing apps work as before. New code should use
//   the verb-specific factories above:
//     r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access }))
//
// For custom logic (default values, business rules, side effects, custom
// executors with ctx.services.searchAdapter, ...) write the handler explicitly with
// r.writeHandler / r.queryHandler — these helpers cover the standard path only.
//
// Note on the `as` casts in the handler bodies: WriteHandlerDef.handler's
// payload type is `unknown` because the dispatcher hands the parsed payload
// through a runtime-only boundary. Each verb knows its post-parse shape (the
// schema we just built two lines up enforces it), so the casts are a
// localised re-declaration of that shape rather than a narrowing escape.

const WRITE_VERBS = ["create", "update", "delete", "restore"] as const;
const QUERY_VERBS = ["list", "detail"] as const;

type UpdatePayload = { id: string; version: number; changes: Record<string, unknown> };
type IdPayload = { id: string };
type ListPayload = {
  cursor?: string;
  limit?: number;
  search?: string;
  sort?: string;
  sortDirection?: "asc" | "desc";
  // Page-based pagination: offset is 0-based and used with limit instead of
  // cursor. Cursor is more precise for infinite scrolling/live tailing; offset
  // suits traditional pagers (← 1 2 ... N →) where the user can jump directly
  // to "page 7". Only ONE variant per request—when both are set, cursor wins
  // for database stability.
  offset?: number;
  // When true, the executor also returns a `total` value in the response.
  // This adds a database round trip (COUNT(*)), so it is useful only when the
  // pager must render "Page X of Y". Omit it for infinite scrolling or when
  // the total is not needed to avoid the COUNT cost.
  totalCount?: boolean;
  // Screen-level filter—an author-declared WHERE clause applied server-side.
  // It provides three buckets of the same entity without custom pages: each
  // screen has its own filter while all use the same query handler.
  filter?: {
    readonly field: string;
    readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
    readonly value: unknown;
  };
  filters?: readonly NamedListFilterCondition[];
  namedFilter?: string;
  aggregate?: ListAggregatePayload;
};

const idSchema = z.object({ id: z.uuid() });

const SYSTEM_ADMIN_ROLE = "SystemAdmin";

// A handler with escapeHatch reads/writes rows of every tenant, so only an operator
// role may reach it — otherwise any tenant-level role holder could read or mutate foreign tenants.
function isSystemAdminOnly(access: AccessRule): boolean {
  return (
    "roles" in access &&
    access.roles.length > 0 &&
    access.roles.every((role) => role === SYSTEM_ADMIN_ROLE)
  );
}

function resolveCrossTenantReason(
  name: string,
  options: EntityHandlerOptions,
  kind: "write" | "query",
): string | undefined {
  if (options.escapeHatch === undefined) return undefined;
  assertReason(`"${name}": escapeHatch`, options.escapeHatch.reason);
  assertEscapeHatchAccessIsSystemAdminOnly(name, kind, options.access);
  return options.escapeHatch.reason;
}

export function assertEscapeHatchAccessIsSystemAdminOnly(
  name: string,
  kind: "write" | "query",
  access: AccessRule,
): void {
  if (!isSystemAdminOnly(access)) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.escapeHatchAccessNotSystemAdmin, {
      message: `"${name}": a ${kind} handler with escapeHatch reaches across every tenant, so its access must be SystemAdmin-only ({ roles: ["${SYSTEM_ADMIN_ROLE}"] }); got ${JSON.stringify(access)}.`,
    });
  }
}

// Upper bound on entity-list `limit`: unbounded/fractional values ran
// straight into the raw `LIMIT ${limit}` SQL string (event-store-executor-
// read.ts), letting a client demand a full-table materialisation or trip a
// Postgres syntax error on a non-integer literal.
export const MAX_LIST_LIMIT = 200;

export const entityListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().nonnegative().max(MAX_LIST_LIMIT).optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  offset: z.number().int().nonnegative().optional(),
  totalCount: z.boolean().optional(),
  // Trash query: include soft-deleted rows. Honoured only for softDelete
  // entities; the dispatcher mirrors it onto ctx.includeDeleted. Tenant +
  // ownership filters still apply.
  includeDeleted: z.boolean().optional(),
  // Trash list: only soft-deleted rows (restore candidates). Rejected together with
  // includeDeleted and on entities without softDelete.
  onlyDeleted: z.boolean().optional(),
  filter: z
    .object({
      field: z.string(),
      op: z.enum(["eq", "ne", "lt", "gt", "lte", "gte", "in"]),
      // `unknown` at compile time; the server checks while building the WHERE
      // clause that the value's type matches the field. z.unknown() accepts
      // everything, so the type check occurs in executor.list.
      value: z.unknown(),
    })
    .optional(),
  // User-selected faceted filters are dynamic and additive to the static
  // `filter`; executor.list combines all of them with AND.
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "ne", "lt", "gt", "lte", "gte", "in"]),
        value: z.unknown(),
      }),
    )
    .optional(),
  // Entity-defined work-queue rule (EntityDefinition.namedFilters); its conditions are appended to `filters`.
  namedFilter: z.string().min(1).max(100).optional(),
  aggregate: listAggregatePayloadSchema.optional(),
});

function parseHandlerName<TVerb extends string>(
  name: string,
  validVerbs: readonly TVerb[],
): { entityName: string; verb: TVerb } {
  const colonIdx = name.indexOf(":");
  if (colonIdx < 0) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.nameWithoutColon, {
      message: `Handler name "${name}" must use the "<entity>:<verb>" pattern (e.g. "note:create").`,
    });
  }
  const entityName = name.slice(0, colonIdx);
  const verbCandidate = name.slice(colonIdx + 1);
  if (!entityName) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.nameMissingEntity, {
      message: `Handler name "${name}" is missing the entity part before the colon.`,
    });
  }
  const verbs = validVerbs as readonly string[]; // @cast-boundary engine-bridge
  if (!verbs.includes(verbCandidate)) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.verbUnknown, {
      message: `Unknown verb "${verbCandidate}" in handler name "${name}". Standard verbs: ${validVerbs.join("/")}. For custom verbs use the explicit r.writeHandler / r.queryHandler form.`,
    });
  }
  return { entityName, verb: verbCandidate as TVerb }; // @cast-boundary engine-bridge
}

function isInTotalsMatchPair(entity: EntityDefinition, fieldName: string): boolean {
  return Object.entries(entity.fields).some(
    ([name, field]) =>
      field.type === "embedded" &&
      field.totalsMatch !== undefined &&
      (name === fieldName || Object.values(field.totalsMatch).includes(fieldName)),
  );
}

// A create/update handler can write a field flagged readAsInstruction: true if:
// update — the field isn't in excludeFields; create — the field isn't excluded,
// or is excluded but has a default (applyDefaults writes it regardless, so the
// define-time floor must match what the executor gate will see at runtime).
function writableInstructionFields(
  verb: "create" | "update",
  entity: EntityDefinition,
  excludedFields: readonly string[],
): readonly string[] {
  return instructionFieldNames(entity).filter((fieldName) => {
    if (!excludedFields.includes(fieldName)) return true;
    if (verb !== "create") return false;
    const field = entity.fields[fieldName];
    return field !== undefined && "default" in field && field.default !== undefined;
  });
}

// delete on an entity without softDelete hard-purges the row, and create/update
// handlers writing a readAsInstruction field are irreversible in effect (a
// revert doesn't undo a run that already read the value) — the agent risk gate
// only protects either case if this handler resolves to "high".
function resolveEntityWriteAgentHints(
  name: string,
  verb: (typeof WRITE_VERBS)[number],
  entity: EntityDefinition,
  agent: AgentHandlerHints | undefined,
  excludedFields: readonly string[],
): AgentHandlerHints | undefined {
  const isIrreversibleDelete = verb === "delete" && !entity.softDelete;
  const instructionFields =
    verb === "create" || verb === "update"
      ? writableInstructionFields(verb, entity, excludedFields)
      : [];
  if (!isIrreversibleDelete && instructionFields.length === 0) return agent;
  if (agent?.risk !== undefined && agent.risk !== "high") {
    const reason = isIrreversibleDelete
      ? "delete on an entity without softDelete is irreversible"
      : `it writes field(s) ${instructionFields.join(", ")} flagged readAsInstruction: true`;
    throw bootRuleError(DEFINITION_HANDLER_RULES.agentRiskNotHigh, {
      message: `"${name}": ${reason} — agent.risk must be "high" (got "${agent.risk}").`,
    });
  }
  return { ...agent, risk: "high" };
}

function assertExcludableFields(
  name: string,
  verb: (typeof WRITE_VERBS)[number],
  entity: EntityDefinition,
  excludedFields: readonly string[],
): void {
  if (excludedFields.length > 0 && verb !== "create" && verb !== "update") {
    throw bootRuleError(DEFINITION_HANDLER_RULES.excludeFieldsVerbUnsupported, {
      message: `"${name}": excludeFields only applies to create and update handlers.`,
    });
  }
  for (const fieldName of excludedFields) {
    const field = entity.fields[fieldName];
    if (!field) {
      throw bootRuleError(DEFINITION_HANDLER_RULES.excludeFieldsUnknownField, {
        message: `"${name}": excludeFields names unknown field "${fieldName}".`,
      });
    }
    if (isInTotalsMatchPair(entity, fieldName)) {
      throw bootRuleError(DEFINITION_HANDLER_RULES.excludeFieldsTotalsPair, {
        message: `"${name}": excludeFields cannot name "${fieldName}" — it is part of a totalsMatch pair, which must be written together.`,
      });
    }
    const isRequired = "required" in field && field.required === true;
    const hasDefault = "default" in field && field.default !== undefined;
    if (verb === "create" && isRequired && !hasDefault) {
      throw bootRuleError(DEFINITION_HANDLER_RULES.excludeFieldsRequiredWithoutDefault, {
        message: `"${name}": excludeFields cannot name "${fieldName}" — it is required without a default, so no row could ever be created.`,
      });
    }
  }
}

/** The phase slots are always unset on entity handlers, so a consumer can spread one into its own
 *  handler and add typed phases without inheriting the slot types. */
export type EntityWriteHandlerDef = WriteHandlerDef & {
  readonly reserveBeforeTransaction?: undefined;
  readonly beforeTransaction?: undefined;
  readonly beforeTransactionWhenNested?: undefined;
};

export function defineEntityWriteHandler(
  name: string,
  entity: EntityDefinition,
  options: EntityWriteHandlerOptions,
): EntityWriteHandlerDef {
  const { entityName, verb } = parseHandlerName(name, WRITE_VERBS);
  if (verb === "restore" && !entity.softDelete) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.restoreWithoutSoftDelete, {
      message: `"${name}": restore is only valid for entities declared with softDelete: true.`,
    });
  }
  const excludedFields = options.excludeFields ?? [];
  assertExcludableFields(name, verb, entity, excludedFields);
  const agentHints = resolveEntityWriteAgentHints(
    name,
    verb,
    entity,
    options.agent,
    excludedFields,
  );

  const table = buildEntityTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });

  // r.systemScope() features (tenant, config, secrets, ...) hand their
  // entity-convention handlers a fail-closed ctx.db — this generic layer
  // has no per-call business reason to give assertTenantMatch, so it
  // acknowledges cross-tenant access on the feature's behalf. This is
  // behavior-preserving: ctx.db was already an unfiltered "system"-mode
  // TenantDb for these handlers before the ctx.db cutover.
  //
  // crossTenantReason (escapeHatch) mirrors the
  // query-handler branch below: this ONE write handler reads/writes across
  // every tenant without making the whole feature r.systemScope().
  const crossTenantReason = resolveCrossTenantReason(name, options, "write");

  // create always writes into the acting user's own tenant, so its FK,
  // unique and preSave lookups must stay tenant-filtered even when the
  // handler declares cross-tenant access for the row-addressing verbs.
  const dbFor = (ctx: HandlerContext): TenantDb => {
    if (ctx.systemDb) {
      return ctx.systemDb.acknowledgeCrossTenant(
        `entity convention handler for r.systemScope() feature (${name})`,
      );
    }
    return crossTenantReason !== undefined && verb !== "create"
      ? acknowledgeConventionCrossTenant(ctx.db, crossTenantReason, {
          deferReport: reportsPerTouchedRow(ctx),
        })
      : ctx.db;
  };

  // actingUserFor reads the row it is about to touch anyway, so for these calls it reports the
  // cross-tenant use per row (with that row as target) instead of dbFor reporting once up front.
  const reportsPerTouchedRow = (ctx: HandlerContext): boolean =>
    ctx.systemDb === undefined && crossTenantReason !== undefined && !entity.systemStream;

  // The event stream defaults to the acting user's tenant (streamTenantFor in
  // event-store-executor-context.ts), not the db's — an unfiltered "system"-mode db alone
  // reads the foreign row but appends to an empty stream in the operator's own tenant,
  // surfacing as a bogus version_conflict. The row's tenant goes to the executor as
  // streamTenantId so stream and PII keys follow the row while the actor stays the operator.
  const foreignRowTenantFor = async (
    user: SessionUser,
    id: unknown,
    db: TenantDb,
    ctx: HandlerContext,
  ): Promise<TenantId | undefined> => {
    if (crossTenantReason === undefined || entity.systemStream) return undefined;
    const row = await db.fetchOne<Record<string, unknown>>(table, { id });
    const rowTenantId = row?.["tenantId"];
    if (reportsPerTouchedRow(ctx)) {
      const targetTenantId = parseTenantId(rowTenantId);
      reportConventionCrossTenantUse(
        db,
        targetTenantId !== null && typeof id === "string"
          ? { id, tenantId: targetTenantId }
          : undefined,
      );
    }
    if (typeof rowTenantId !== "string" || rowTenantId === user.tenantId) return undefined;
    const streamTenantId = parseTenantId(rowTenantId);
    if (streamTenantId === null) {
      throw new InternalError({
        message: `"${name}": row ${String(id)} has tenantId "${rowTenantId}" which is not a TenantId; refusing to append to the wrong stream.`,
      });
    }
    return streamTenantId;
  };

  let schema: ZodType;
  let handler: WriteHandlerDef["handler"];

  switch (verb) {
    case "create":
      schema = buildInsertSchema(entity, undefined, excludedFields, { allowCallerId: true });
      handler = async (event, ctx) => {
        const {
          lifecycle: { runPreSave },
        } = ctx;
        // A caller-chosen id (deterministic-id idempotent creates) is only
        // honored for a system-identity caller (jobs/hooks via
        // createSystemUser) — an HTTP-authenticated end user can never
        // present that identity, so their payload.id is dropped exactly as
        // before this field became part of the schema.
        const { id: _callerId, ...payloadWithoutId } = event.payload as DbRow;
        const payload = dropEmptyWriteOnlyValues(
          entity,
          isSystemIdentity(event.user) ? (event.payload as DbRow) : payloadWithoutId,
        );
        return executor.create(payload, event.user, dbFor(ctx), {
          preSave:
            runPreSave &&
            ((changes, previous, isNew) => runPreSave(event.type, changes, previous, isNew)),
        });
      };
      break;
    case "update":
      schema = z.object({
        id: z.uuid(),
        version: z.number(),
        changes: buildUpdateSchema(entity, undefined, excludedFields),
      });
      handler = async (event, ctx) => {
        const {
          lifecycle: { runPreSave },
        } = ctx;
        const db = dbFor(ctx);
        const submitted = event.payload as UpdatePayload; // @cast-boundary engine-payload
        const payload = {
          ...submitted,
          changes: dropEmptyWriteOnlyValues(entity, submitted.changes),
        };
        const streamTenantId = await foreignRowTenantFor(event.user, payload.id, db, ctx);
        // skipUnchanged: API-driven updates diff against the stored
        // row so a resubmitted-but-identical field doesn't force a fresh
        // pii/encrypted ciphertext. Direct executor.update() callers (e.g.
        // KEK-rotation, the user-data-rights backfill) don't go through
        // this handler and keep today's always-re-encrypt behavior, which
        // they rely on to intentionally force a fresh event/ciphertext.
        return executor.update(payload, event.user, db, {
          streamTenantId,
          parentVisibility: parentVisibilityFor(ctx, event.user),
          skipUnchanged: true,
          preSave:
            runPreSave &&
            ((changes, previous, isNew) => runPreSave(event.type, changes, previous, isNew)),
        });
      };
      break;
    case "delete":
      schema = idSchema;
      handler = async (event, ctx) => {
        const db = dbFor(ctx);
        const payload = event.payload as IdPayload; // @cast-boundary engine-payload
        const streamTenantId = await foreignRowTenantFor(event.user, payload.id, db, ctx);
        return executor.delete(payload, event.user, db, {
          streamTenantId,
          parentVisibility: parentVisibilityFor(ctx, event.user),
        });
      };
      break;
    case "restore":
      schema = idSchema;
      handler = async (event, ctx) => {
        const db = dbFor(ctx);
        const payload = event.payload as IdPayload; // @cast-boundary engine-payload
        const streamTenantId = await foreignRowTenantFor(event.user, payload.id, db, ctx);
        return executor.restore(payload, event.user, db, {
          streamTenantId,
          parentVisibility: parentVisibilityFor(ctx, event.user),
        });
      };
      break;
    default:
      assertUnreachable(verb, "write verb");
  }

  // escapeHatch stays off the def: WriteHandlerDef.escapeHatch also grants unsafeRaw, global writes, identity switches.
  return {
    name,
    schema,
    handler,
    access: options.access,
    ...(options.description !== undefined && { description: options.description }),
    ...(agentHints !== undefined && { agent: agentHints }),
    ...(excludedFields.length > 0 && { excludedFields }),
  };
}

// Runs the JS `derive` fields on the row shape the view-model will see (after the SQL fetch,
// reference eagerload and SQL derived values), so a JS derive may read a SQL derived value.
// Clock comes from the handler's tz context, never Temporal.Now.
function augmentDerivedFields(
  rows: readonly Record<string, unknown>[],
  entity: EntityDefinition,
  asOf: Temporal.Instant,
): readonly Record<string, unknown>[] {
  const derived = entity.derivedFields;
  if (derived === undefined) return rows;
  const jsEntries = Object.entries(derived).flatMap(([fieldName, def]) =>
    isSqlDerivedField(def) ? [] : [[fieldName, def.derive] as const],
  );
  if (jsEntries.length === 0) return rows;
  const ctx: DeriveContext = { asOf };
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [fieldName, derive] of jsEntries) {
      out[fieldName] = derive(row, ctx);
    }
    return out;
  });
}

export function defineEntityQueryHandler(
  name: string,
  entity: EntityDefinition,
  options: EntityQueryHandlerOptions,
): QueryHandlerDef {
  const { entityName, verb } = parseHandlerName(name, QUERY_VERBS);

  const table = buildEntityTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });

  let schema: ZodType;
  let handler: QueryHandlerDef["handler"];

  // Server-side eager loading: when the entity has reference fields, the
  // handler resolves the UUIDs against the referenced entities after the
  // main query. The `_refs` property lands on every row; the renderer-side
  // useReferenceLookup stays as a fallback (for apps that write custom
  // handlers by hand without this wrapper).
  const hasRefFields = collectReferenceFields(entity).length > 0;
  const crossTenantReason = resolveCrossTenantReason(name, options, "query");

  // Preference order:
  //  1. ctx.systemDb — the feature declared r.systemScope() (whole-feature
  //     cutover, dispatch-shared.ts), so ctx.db is fail-closed. This is
  //     behavior-preserving: ctx.db was already an unfiltered "system"-mode
  //     TenantDb for these handlers before that cutover.
  //  2. crossTenantReason (escapeHatch) — this
  //     ONE handler reads across every tenant (e.g. a SystemAdmin-only
  //     operator inspector) without making the whole feature r.systemScope()
  //     — that would drop tenant isolation from every OTHER handler the
  //     feature registers too. The executor's list()/detail() only add a
  //     tenant filter when db.mode === "tenant" (see event-store-executor.ts),
  //     so handing them a "system"-mode TenantDb built from the same raw
  //     connection is enough to skip it — access-control (who may call this
  //     handler at all) is unaffected, still gated by `options.access`.
  //  3. plain ctx.db — the common case, tenant-filtered.
  const dbFor = (ctx: HandlerContext): TenantDb => {
    if (ctx.systemDb) {
      return ctx.systemDb.acknowledgeCrossTenant(
        `entity convention handler for r.systemScope() feature (${entityName}:${verb})`,
      );
    }
    return crossTenantReason !== undefined
      ? acknowledgeConventionCrossTenant(ctx.db, crossTenantReason)
      : ctx.db;
  };

  switch (verb) {
    case "list":
      schema = entityListSchema;
      handler = async (query, ctx) => {
        // Pass the SearchAdapter from ctx through so payload.search is executed
        // against Meilisearch/InMem at runtime (remote combobox search). The
        // executor is built at definition time and cannot know the adapter, so the
        // runtime override supplies it.
        const requestPayload = query.payload as ListPayload; // @cast-boundary engine-payload
        const listPayload =
          requestPayload.namedFilter === undefined
            ? requestPayload
            : {
                ...requestPayload,
                filters: [
                  ...(requestPayload.filters ?? []),
                  ...(await resolveNamedListFilters(
                    ctx,
                    query.user,
                    entityName,
                    requestPayload.namedFilter,
                  )),
                ],
              };
        const db = dbFor(ctx);
        const { runtimeOptions, eagerLoadViewer, resolveEntity } = entityListRuntime(
          ctx,
          entityName,
          query.user,
        );
        if (listPayload.aggregate !== undefined) {
          return answerListAggregate(
            executor,
            { ...listPayload, aggregate: listPayload.aggregate },
            query.user,
            db,
            runtimeOptions,
            { entity, resolveEntity, viewer: eagerLoadViewer },
          );
        }
        const result = await executor.list(listPayload, query.user, db, runtimeOptions);
        const enrichedRows = hasRefFields
          ? await enrichWithReferences(result.rows, entity, resolveEntity, db, eagerLoadViewer)
          : result.rows;
        return { ...result, rows: augmentDerivedFields(enrichedRows, entity, ctx.tz.now()) };
      };
      break;
    case "detail":
      schema = idSchema;
      handler = async (query, ctx) => {
        const db = dbFor(ctx);
        const row = await executor.detail(query.payload as IdPayload, query.user, db, {
          parentVisibility: parentVisibilityFor(ctx, query.user),
        }); // @cast-boundary engine-payload
        if (row === null || !hasRefFields) return row;
        return enrichRowWithReferences(row, entity, (name) => ctx.registry.getEntity(name), db, {
          user: query.user,
          parentVisibility: parentVisibilityFor(ctx, query.user),
        });
      };
      break;
    default:
      assertUnreachable(verb, "query verb");
  }

  // escapeHatch stays off the def: QueryHandlerDef.escapeHatch also grants unsafeRaw and identity switches.
  return {
    name,
    schema,
    handler,
    access: options.access,
    ...(options.description !== undefined && { description: options.description }),
    ...(options.agent !== undefined && { agent: options.agent }),
    // The "list" verb's executor.list() always returns { rows, nextCursor,
    // total? } (see the handler body above) — brand it so the definition
    // site documents the PagedRows contract without needing
    // definePagedQueryHandler on top. The "detail" verb returns a single
    // row/null, never this shape.
    ...(verb === "list" && { [PAGED_QUERY_HANDLER_BRAND]: true }),
    [ENTITY_CONVENTION_QUERY_BRAND]: true,
  };
}

// ─── Verb-specific factories (preferred) ──────────────────────────────
//
// One function per verb — verb is the function name, no magic-string
// parsing. Each delegates to the legacy `defineEntityWriteHandler` /
// `defineEntityQueryHandler` with a fixed verb-suffix; the schema +
// handler-body logic is unchanged. Migration from the legacy API is a
// 1:1 rename — same arguments minus the verb-prefix in the name-string.
//
// Why prefer these over the legacy form:
//   - Verb is checked at compile-time (no runtime "Unknown verb" throw)
//   - IDE auto-completes the four/two verbs after typing `defineEntity`
//   - Function name is self-documenting; no comment needed to explain
//   - Entity-name appears once (used to be doubled: once in the string,
//     once as the entity-arg)
//
// Restore-specific note: defineEntityRestoreHandler still validates at
// runtime that entity.softDelete === true. A compile-time-only check
// would need a Branded-EntityDefinition with `softDelete: true` literal
// — feasible but not yet wired; the runtime guard catches misuse.

// @wrapper-known semantic-alias
export function defineEntityCreateHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityWriteHandlerOptions,
): EntityWriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:create`, entity, options);
}

// @wrapper-known semantic-alias
export function defineEntityUpdateHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityWriteHandlerOptions,
): EntityWriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:update`, entity, options);
}

// @wrapper-known semantic-alias
export function defineEntityDeleteHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityHandlerOptions,
): EntityWriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:delete`, entity, options);
}

// @wrapper-known semantic-alias
export function defineEntityRestoreHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityHandlerOptions,
): EntityWriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:restore`, entity, options);
}

// @wrapper-known semantic-alias
export function defineEntityListHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityQueryHandlerOptions,
): QueryHandlerDef {
  return defineEntityQueryHandler(`${entityName}:list`, entity, options);
}

// @wrapper-known semantic-alias
export function defineEntityDetailHandler(
  entityName: string,
  entity: EntityDefinition,
  options: EntityQueryHandlerOptions,
): QueryHandlerDef {
  return defineEntityQueryHandler(`${entityName}:detail`, entity, options);
}

// Bundle the two calls every custom write-handler opens with: build the
// Drizzle table from the entity, then wire an event-store executor onto it.
// The pair is identical in every sample that hand-writes handlers, so the
// helper collapses 3-4 lines + the { entityName } bookkeeping into one.
//
//   const { table, executor } = createEntityExecutor("counter", counterEntity);
//
// Keep using the explicit buildEntityTable / createEventStoreExecutor duo
// when you need search-adapter / entity-cache options on the executor — this
// helper covers the zero-config case.
export function createEntityExecutor<E extends EntityDefinition>(
  entityName: string,
  entity: E,
): { readonly table: EntityTable; readonly executor: EventStoreExecutor<EntityRow<E>> } {
  const table = buildEntityTable<EntityDefinition>(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });
  return { table, executor };
}

// Wrap a projection read into a zero-argument query handler. Use when the
// read is "give me all rows from projection X, tenant-scoped" — the common
// shape for list-views backed by an MSP/projection table.
//
//   r.queryHandler(
//     defineProjectionQueryHandler("revenue:list", "showcase:projection:customer-revenue", {
//       access: { openToAll: { reason: "any signed-in user reviews aggregate revenue" } },
//     }),
//   );
//
// For anything more involved (filters, joins, custom shaping), write the
// query-handler explicitly with ctx.dispatch.queryProjection or a raw select.
export function defineProjectionQueryHandler(
  name: string,
  projectionQualifiedName: string,
  options: {
    access: AccessRule;
    // The object form doubles as the handler's escapeHatch declaration (grant + audit reason);
    // an explicit `escapeHatch` option wins when both are given.
    unsafeAllTenants?: boolean | { readonly reason: string };
    escapeHatch?: EscapeHatchDeclaration;
  },
): QueryHandlerDef {
  if (typeof options.unsafeAllTenants === "object") {
    assertReason(`"${name}": unsafeAllTenants`, options.unsafeAllTenants.reason);
  }
  const escapeHatch: EscapeHatchDeclaration | undefined =
    options.escapeHatch ??
    (typeof options.unsafeAllTenants === "object"
      ? { reason: options.unsafeAllTenants.reason }
      : undefined);
  return {
    name,
    schema: z.object({}),
    // Returns the raw row array — matches ctx.dispatch.queryProjection's shape so the
    // helper is a drop-in for the inline `async (_q, ctx) => ctx.dispatch.queryProjection(...)`
    // handler. Wrap the result in the caller's handler when you need
    // pagination envelopes or added metadata.
    handler: async (_query, ctx) =>
      ctx.dispatch.queryProjection(
        projectionQualifiedName,
        options.unsafeAllTenants ? { unsafeAllTenants: true } : undefined,
      ), // @wrapper-known semantic-alias
    access: options.access,
    ...(escapeHatch && { escapeHatch }),
  };
}

function defaultCrudVerbs(entity: EntityDefinition): Record<EntityCrudVerb, boolean> {
  return {
    create: true,
    update: true,
    delete: true,
    restore: entity.softDelete === true,
    list: true,
    detail: true,
  };
}

/** Backs `r.crud`: registers the standard entity CRUD handlers. Access stays explicit — no openToAll default. */
export function registerCrudHandlers(
  r: EntityCrudRegistrar,
  entityName: string,
  entity: EntityDefinition,
  options?: RegisterEntityCrudOptions,
): void {
  const verbs = { ...defaultCrudVerbs(entity), ...options?.verbs };
  if (verbs.restore && entity.softDelete !== true) {
    throw bootRuleError(DEFINITION_HANDLER_RULES.restoreWithoutSoftDelete, {
      message: `restore requested but entity "${entityName}" has no softDelete: true`,
    });
  }

  if (options?.registerEntity !== false) {
    r.entity({ name: entityName, ...entity });
  }
  const writeOpts = options?.write;
  const readOpts = options?.read;
  const requireAccess = (verb: EntityCrudVerb, access: AccessRule | undefined): AccessRule => {
    if (!access) {
      throw bootRuleError(DEFINITION_HANDLER_RULES.crudAccessUnresolved, {
        message:
          `r.crud("${entityName}", …): no access rule resolved for verb "${verb}". ` +
          `Set write.access/read.access in r.crud's options, or verbAccess.${verb}.`,
      });
    }
    return access;
  };
  const resolveWriteOpts = (verb: EntityCrudVerb): EntityWriteHandlerOptions => {
    const excludeFields =
      verb === "create" || verb === "update" ? options?.excludeFields?.[verb] : undefined;
    const verbAgent = options?.agents?.[verb];
    return {
      ...writeOpts,
      access: requireAccess(verb, options?.verbAccess?.[verb] ?? writeOpts?.access),
      description: options?.descriptions?.[verb] ?? writeOpts?.description,
      ...(verbAgent !== undefined && { agent: { ...writeOpts?.agent, ...verbAgent } }),
      ...(excludeFields !== undefined && { excludeFields }),
    };
  };
  const resolveReadOpts = (verb: EntityCrudVerb): EntityQueryHandlerOptions => {
    const verbAgent = options?.agents?.[verb];
    return {
      ...readOpts,
      access: requireAccess(verb, options?.verbAccess?.[verb] ?? readOpts?.access),
      description: options?.descriptions?.[verb] ?? readOpts?.description,
      ...(verbAgent !== undefined && { agent: { ...readOpts?.agent, ...verbAgent } }),
    };
  };

  if (verbs.create) {
    r.writeHandler(defineEntityCreateHandler(entityName, entity, resolveWriteOpts("create")));
  }
  if (verbs.update) {
    r.writeHandler(defineEntityUpdateHandler(entityName, entity, resolveWriteOpts("update")));
  }
  if (verbs.delete) {
    r.writeHandler(defineEntityDeleteHandler(entityName, entity, resolveWriteOpts("delete")));
  }
  if (verbs.restore) {
    r.writeHandler(defineEntityRestoreHandler(entityName, entity, resolveWriteOpts("restore")));
  }
  if (verbs.list) {
    r.queryHandler(defineEntityListHandler(entityName, entity, resolveReadOpts("list")));
  }
  if (verbs.detail) {
    r.queryHandler(defineEntityDetailHandler(entityName, entity, resolveReadOpts("detail")));
  }
}
