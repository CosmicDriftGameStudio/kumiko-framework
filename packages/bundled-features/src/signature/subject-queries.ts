import {
  entityListSchema,
  type HandlerContext,
  MAX_LIST_LIMIT,
  type QueryHandlerDef,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { requestExecutor } from "./entity.ts";
import type { SubjectScope } from "./subject-scope.ts";

type ListPayload = ReturnType<typeof entityListSchema.parse>;
type ListFilter = NonNullable<ListPayload["filter"]>;

function allFilters(payload: ListPayload): readonly ListFilter[] {
  return [...(payload.filter === undefined ? [] : [payload.filter]), ...(payload.filters ?? [])];
}

function emptyPage(payload: ListPayload) {
  return { rows: [], nextCursor: null, ...(payload.totalCount === true && { total: 0 }) };
}

function onlyFilterOn(payload: ListPayload, field: string): ListFilter | null {
  const matching = allFilters(payload).filter((filter) => filter.field === field);
  const [first] = matching;
  return matching.length === 1 && first !== undefined ? first : null;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : null;
}

function replaceFilterValue(payload: ListPayload, target: ListFilter, value: unknown): ListPayload {
  const swap = (filter: ListFilter): ListFilter =>
    filter === target ? { ...filter, value } : filter;
  return {
    ...payload,
    ...(payload.filter !== undefined && { filter: swap(payload.filter) }),
    ...(payload.filters !== undefined && { filters: payload.filters.map(swap) }),
  };
}

export function scopeRequestList(base: QueryHandlerDef, scope: SubjectScope): QueryHandlerDef {
  return {
    ...base,
    handler: async (query, ctx) => {
      const user = query.user;
      if (!scope.isScoped(user)) return base.handler(query, ctx);
      const payload = entityListSchema.parse(query.payload);
      const typeFilter = onlyFilterOn(payload, "subjectType");
      const idFilter = onlyFilterOn(payload, "subjectId");
      if (
        typeFilter === null ||
        typeFilter.op !== "eq" ||
        typeof typeFilter.value !== "string" ||
        idFilter === null
      ) {
        throw new AccessDeniedError();
      }
      let requested: readonly string[] | null;
      if (idFilter.op === "eq") {
        requested = typeof idFilter.value === "string" ? [idFilter.value] : null;
      } else if (idFilter.op === "in") {
        requested = stringList(idFilter.value);
      } else {
        requested = null;
      }
      // The cap bounds the hook calls one query can trigger.
      if (requested === null || requested.length > MAX_LIST_LIMIT) throw new AccessDeniedError();
      const subjectType = typeFilter.value;
      // ponytail: one hook call per subjectId; add a batch hook when lists get large.
      const verdicts = await Promise.all(
        requested.map((subjectId) => scope.allows(ctx, user, subjectType, subjectId)),
      );
      const allowed = requested.filter((_, index) => verdicts[index]);
      if (allowed.length === 0) return emptyPage(payload);
      const narrowed =
        idFilter.op === "in" ? replaceFilterValue(payload, idFilter, allowed) : payload;
      return base.handler({ ...query, payload: narrowed }, ctx);
    },
  };
}

export function scopeRequestDetail(base: QueryHandlerDef, scope: SubjectScope): QueryHandlerDef {
  return {
    ...base,
    handler: async (query, ctx) => {
      const row = await base.handler(query, ctx);
      if (row === null || !scope.isScoped(query.user)) return row;
      return (await scope.allowsRequest(ctx, query.user, subjectOf(row))) ? row : null;
    },
  };
}

function subjectOf(row: unknown): { subjectType?: unknown; subjectId?: unknown } {
  if (typeof row !== "object" || row === null) return {};
  return {
    subjectType: "subjectType" in row ? row.subjectType : undefined,
    subjectId: "subjectId" in row ? row.subjectId : undefined,
  };
}

export function scopeSignerList(base: QueryHandlerDef, scope: SubjectScope): QueryHandlerDef {
  return {
    ...base,
    handler: async (query, ctx: HandlerContext) => {
      const user: SessionUser = query.user;
      if (!scope.isScoped(user)) return base.handler(query, ctx);
      const payload = entityListSchema.parse(query.payload);
      const requestFilter = onlyFilterOn(payload, "requestId");
      if (
        requestFilter === null ||
        requestFilter.op !== "eq" ||
        typeof requestFilter.value !== "string"
      ) {
        throw new AccessDeniedError();
      }
      const request = await requestExecutor.detail({ id: requestFilter.value }, user, ctx.db);
      if (request === null || !(await scope.allowsRequest(ctx, user, request))) {
        return emptyPage(payload);
      }
      return base.handler(query, ctx);
    },
  };
}
