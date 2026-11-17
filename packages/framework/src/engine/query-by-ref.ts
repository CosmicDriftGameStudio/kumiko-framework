import type { HandlerDispatch, QueryHandlerRef } from "@cosmicdrift/kumiko-types/handlers";

// The result type is the target handler's own inferred return type, so dispatch.query's erased
// Promise<unknown> is narrowed once here instead of by a cast at every caller. Field read rules of a
// resultEntity can still drop fields at runtime that the type shows.
export function queryByRef<TPayload, TResult>(
  dispatch: Pick<HandlerDispatch, "query">,
  ref: QueryHandlerRef<TPayload, TResult>,
  payload: NoInfer<TPayload>,
): Promise<TResult>;
export function queryByRef(
  dispatch: Pick<HandlerDispatch, "query">,
  ref: { readonly qualifiedName: string },
  payload: unknown,
): Promise<unknown> {
  return dispatch.query(ref.qualifiedName, payload);
}
