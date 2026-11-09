import {
  DEFAULT_LIST_LIMIT,
  entityListSchema,
  type HandlerContext,
  isUuid,
  MAX_LIST_LIMIT,
  type QueryHandlerDef,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { requestExecutor } from "./entity.ts";
import { openListCursor, sealListCursor } from "./list-cursor-seal.ts";
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

type RowsPage = { rows: unknown[] } & Record<string, unknown>;

function isRowsPage(value: unknown): value is RowsPage {
  return (
    typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows)
  );
}

function subjectKey(subject: { subjectType?: unknown; subjectId?: unknown }): string {
  return `${String(subject.subjectType)}\u0000${String(subject.subjectId)}`;
}

// ponytail: at most this many base pages per answer; a user who may see almost none of the
// tenant's requests gets short pages and scrolls on. Upgrade to a subject-joined query if that hurts.
const MAX_BASE_PAGES_PER_ANSWER = 10;
// authorizeSubject usually queries the database; a page of 200 subjects must not take the whole pool.
const SUBJECT_CHECKS_IN_PARALLEL = 10;

type ListQuery = Parameters<QueryHandlerDef["handler"]>[0];

async function openFirstQuery(
  query: ListQuery,
  payload: ListPayload,
  user: SessionUser,
  cursorSecret: string,
): Promise<ListQuery> {
  const { cursor: sealedCursor, ...payloadWithoutCursor } = payload;
  if (sealedCursor === undefined) return query;
  const openedCursor = await openListCursor(sealedCursor, user, cursorSecret);
  if (openedCursor === null) throw new AccessDeniedError();
  return { ...query, payload: { ...payloadWithoutCursor, cursor: openedCursor } };
}

async function sealedPage(
  page: RowsPage,
  visibleRows: unknown[],
  nextCursor: unknown,
  user: SessionUser,
  cursorSecret: string,
) {
  // `total` would count requests of foreign subjects. The base cursor names the last base row,
  // which may belong to a foreign subject, so the user only gets it sealed.
  const { total: _total, rows: _rows, nextCursor: _baseCursor, ...rest } = page;
  return {
    ...rest,
    rows: visibleRows,
    nextCursor:
      typeof nextCursor === "string" ? await sealListCursor(nextCursor, user, cursorSecret) : null,
  };
}

export function scopeRequestList(
  base: QueryHandlerDef,
  scope: SubjectScope,
  cursorSecret: string,
): QueryHandlerDef {
  return {
    ...base,
    handler: async (query, ctx) => {
      const user = query.user;
      if (!scope.isScoped(user)) return base.handler(query, ctx);
      const payload = entityListSchema.parse(query.payload);
      // Group counts would include requests of foreign subjects, and an offset counts base rows,
      // not the rows this user sees; the screen pages by cursor. limit 0 would hand out a cursor
      // without checking a row.
      if (payload.aggregate !== undefined || (payload.offset ?? 0) > 0 || payload.limit === 0) {
        throw new AccessDeniedError();
      }
      const limit = payload.limit ?? DEFAULT_LIST_LIMIT;
      const verdicts = new Map<string, boolean>();
      const visibleRows: unknown[] = [];
      const firstQuery = await openFirstQuery(query, payload, user, cursorSecret);
      let page: unknown = await base.handler(firstQuery, ctx);
      for (let fetched = 1; ; fetched++) {
        if (!isRowsPage(page)) throw new Error("signature request list did not return a rows page");
        const unknownSubjects = new Map(
          page.rows
            .map((row) => [subjectKey(subjectOf(row)), subjectOf(row)] as const)
            .filter(([key]) => !verdicts.has(key)),
        );
        const pending = [...unknownSubjects];
        for (let start = 0; start < pending.length; start += SUBJECT_CHECKS_IN_PARALLEL) {
          await Promise.all(
            pending.slice(start, start + SUBJECT_CHECKS_IN_PARALLEL).map(async ([key, subject]) => {
              verdicts.set(key, await scope.allowsRequest(ctx, user, subject));
            }),
          );
        }
        visibleRows.push(...page.rows.filter((row) => verdicts.get(subjectKey(subjectOf(row)))));
        const nextCursor = page["nextCursor"];
        if (
          visibleRows.length >= limit ||
          typeof nextCursor !== "string" ||
          fetched >= MAX_BASE_PAGES_PER_ANSWER ||
          verdicts.size >= MAX_LIST_LIMIT
        ) {
          return sealedPage(page, visibleRows, nextCursor, user, cursorSecret);
        }
        page = await base.handler(
          {
            ...query,
            payload: { ...payload, cursor: nextCursor, limit: limit - visibleRows.length },
          },
          ctx,
        );
      }
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
      if (!isUuid(requestFilter.value)) return emptyPage(payload);
      const request = await requestExecutor.detail({ id: requestFilter.value }, user, ctx.db);
      if (request === null || !(await scope.allowsRequest(ctx, user, request))) {
        return emptyPage(payload);
      }
      return base.handler(query, ctx);
    },
  };
}
