import {
  buildRequestContextDataFromRequest,
  type ClientIpResolver,
} from "@cosmicdrift/kumiko-framework/api";
import { createAnonymousUser, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { requestContext } from "@cosmicdrift/kumiko-framework/internal/request-context";
import type { PageHeadSystemQuery } from "@cosmicdrift/kumiko-headless/apex";

export type QueryDispatcher = {
  readonly query: (type: string, payload: unknown, user: SessionUser) => Promise<unknown>;
};

// Single wiring for the anonymous-role systemQuery that page-head and
// hostDispatch resolvers receive, shared by runProdApp and the dev server so
// the anonymous role / request-context / client-IP resolution can't drift.
export function buildRequestBoundSystemQuery(params: {
  readonly req: Request;
  readonly dispatcher: QueryDispatcher;
  readonly resolver: ClientIpResolver;
  readonly socketAddress?: string;
}): PageHeadSystemQuery {
  const { req, dispatcher, resolver, socketAddress } = params;
  return (type, payload, tenantId, options) => {
    const base =
      requestContext.get() ?? buildRequestContextDataFromRequest(req, { resolver, socketAddress });
    // The caller's signal replaces the request's: it already folds the request signal in.
    const data = options?.signal ? { ...base, signal: options.signal } : base;
    return requestContext.run(data, () =>
      dispatcher.query(type, payload, createAnonymousUser(tenantId)),
    );
  };
}
