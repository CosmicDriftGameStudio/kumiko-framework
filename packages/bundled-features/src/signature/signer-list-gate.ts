import {
  entityListSchema,
  type HandlerContext,
  isUuid,
  type QueryHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { requestExecutor } from "./entity.ts";
import { requestHostIsVisible } from "./lib.ts";

type ListPayload = ReturnType<typeof entityListSchema.parse>;

// A request is itself a join row and the parentRef gate does not recurse, so signers are read
// one request at a time and only while that request's host is visible.
export function gateSignerListByRequestHost(base: QueryHandlerDef): QueryHandlerDef {
  return {
    ...base,
    handler: async (query, ctx: HandlerContext) => {
      const payload = entityListSchema.parse(query.payload);
      const requestFilters = [
        ...(payload.filter === undefined ? [] : [payload.filter]),
        ...(payload.filters ?? []),
      ].filter((filter) => filter.field === "requestId");
      const [requestFilter] = requestFilters;
      if (
        requestFilters.length !== 1 ||
        requestFilter === undefined ||
        requestFilter.op !== "eq" ||
        typeof requestFilter.value !== "string"
      ) {
        throw new AccessDeniedError();
      }
      if (!isUuid(requestFilter.value)) return emptyPage(payload);
      const request = await requestExecutor.detail({ id: requestFilter.value }, query.user, ctx.db);
      if (request === null || !(await requestHostIsVisible(ctx, query.user, request))) {
        return emptyPage(payload);
      }
      return base.handler(query, ctx);
    },
  };
}

function emptyPage(payload: ListPayload) {
  return { rows: [], nextCursor: null, ...(payload.totalCount === true && { total: 0 }) };
}
