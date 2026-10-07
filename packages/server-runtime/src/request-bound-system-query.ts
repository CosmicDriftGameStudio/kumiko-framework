import {
  buildRequestContextDataFromRequest,
  type ClientIpResolver,
  requestContext,
} from "@cosmicdrift/kumiko-framework/api";
import { createAnonymousUser, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
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
  return (type, payload, tenantId) =>
    requestContext.run(
      requestContext.get() ?? buildRequestContextDataFromRequest(req, { resolver, socketAddress }),
      () => dispatcher.query(type, payload, createAnonymousUser(tenantId)),
    );
}
