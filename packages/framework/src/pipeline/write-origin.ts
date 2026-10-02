// The static check in boot-validator/access-declarations.ts only sees a handler's own
// input schema; writes reached via ctx.write/writeAs/queryAs, hooks or foreign-feature
// tables are only visible at the actual write, so the gate runs there at runtime.
import { isPersonalDataGated, type WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import * as z from "zod";
import { buildEntityTable } from "../db/table-builder.js";
import { type PersonalDataGate, tableNameOf } from "../db/tenant-db.js";
import {
  accessAllowsAnonymous,
  declaredPersonalData,
  personalFieldNames,
} from "../engine/personal-data-fields.js";
import { ANONYMOUS_ROLE } from "../engine/system-user.js";
import type { EntityDefinition } from "../engine/types/fields.js";
import type { AccessRule, Registry, SessionUser } from "../engine/types/index.js";
import { AccessDeniedError } from "../errors/index.js";
import { FrameworkReasons } from "../errors/reasons.js";
import { toSnakeCase } from "../utils/case.js";

export { isPersonalDataGated, type WriteOrigin };

// Only narrows: an inherited origin can add a gate, never lift the root's.
export function effectiveWriteOrigin(root: WriteOrigin, inherited?: WriteOrigin): WriteOrigin {
  if (!inherited) return root;
  if (isPersonalDataGated(root)) return root;
  if (isPersonalDataGated(inherited)) return inherited;
  return root;
}

const writeOriginSchema = z
  .object({
    rootHandler: z.string(),
    anonymousRoot: z.boolean(),
    publicIntake: z.boolean(),
    viaJob: z.string().optional(),
  })
  .strict();

export function parseWriteOrigin(value: unknown): WriteOrigin | undefined {
  const parsed = writeOriginSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function declaresPublicIntake(access: AccessRule): boolean {
  return accessAllowsAnonymous(access) && declaredPersonalData(access) === "public-intake";
}

// Only the public dispatcher entry points compute a root; every nested call inherits
// it, so switching identity via ctx.writeAs(SYSTEM, ...) cannot shed an anonymous root.
export function rootWriteOrigin(registry: Registry, type: string, user: SessionUser): WriteOrigin {
  const writeHandler = registry.getWriteHandler(type);
  return {
    rootHandler: type,
    anonymousRoot: user.roles.includes(ANONYMOUS_ROLE),
    publicIntake: writeHandler !== undefined && declaresPublicIntake(writeHandler.access),
  };
}

// Owner binding is ignored (honorOwnerBinding=false): all anonymous callers share one
// user id, so from("user:id", ...) vouches for nobody.
const personalDataTableMaps = new WeakMap<Registry, ReadonlyMap<string, ReadonlySet<string>>>();

const personalColumnsByEntity = new WeakMap<EntityDefinition, ReadonlySet<string>>();

function personalColumnNames(entity: EntityDefinition): ReadonlySet<string> {
  const cached = personalColumnsByEntity.get(entity);
  if (cached) return cached;
  const columns = new Set([...personalFieldNames(entity, false)].map(toSnakeCase));
  personalColumnsByEntity.set(entity, columns);
  return columns;
}

function buildPersonalDataTableMap(registry: Registry): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, ReadonlySet<string>>();
  for (const [entityName, entity] of registry.getAllEntities()) {
    const columns = personalColumnNames(entity);
    if (columns.size === 0) continue;
    const table = buildEntityTable(entityName, entity, {
      relations: registry.getRelations(entityName),
    });
    map.set(tableNameOf(table), columns);
  }
  return map;
}

function personalDataTableMap(registry: Registry): ReadonlyMap<string, ReadonlySet<string>> {
  const cached = personalDataTableMaps.get(registry);
  if (cached) return cached;
  const built = buildPersonalDataTableMap(registry);
  personalDataTableMaps.set(registry, built);
  return built;
}

// The error reaches the anonymous HTTP caller, so table and column names stay out of
// message/details (they would map the DB schema); they travel in `cause`, which the
// serializer never sends to clients but the error log keeps.
export function publicIntakeRequiredError(
  origin: WriteOrigin,
  target: string,
  fields: readonly string[],
): AccessDeniedError {
  return new AccessDeniedError({
    message:
      `Anonymous root handler "${origin.rootHandler}" wrote personal data` +
      (origin.viaJob ? ` via job "${origin.viaJob}"` : "") +
      '. Declare access: { roles: [..., "anonymous"], personalData: "public-intake" } on ' +
      `"${origin.rootHandler}" to allow anonymous callers to write personal data.`,
    details: {
      reason: FrameworkReasons.publicIntakeRequired,
      rootHandler: origin.rootHandler,
      ...(origin.viaJob !== undefined && { job: origin.viaJob }),
    },
    cause: new Error(
      `personal-data field(s) ${fields.map((f) => `"${f}"`).join(", ")} written on "${target}"`,
    ),
  });
}

// Without an entity the table name is looked up in the registry map; tables outside it
// (unmanaged stores, hand-built tables) carry no personal-data annotations and pass.
export function buildPersonalDataGate(
  registry: Registry,
  origin: WriteOrigin,
): PersonalDataGate | undefined {
  if (!isPersonalDataGated(origin)) return undefined;
  const map = personalDataTableMap(registry);
  return (tableName, keys, entity) => {
    const personalFields = entity ? personalColumnNames(entity) : map.get(tableName);
    // skip: table carries no personal-data annotations
    if (!personalFields) return;
    const offending = [...new Set(keys.map(toSnakeCase))].filter((k) => personalFields.has(k));
    // skip: write touches no personal-data field
    if (offending.length === 0) return;
    throw publicIntakeRequiredError(origin, tableName, offending);
  };
}
