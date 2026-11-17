import type { SessionUser, WriteResult } from "./handlers.ts";

declare const handlerContractTypes: unique symbol;

export type QueryQualifiedName = `${string}:query:${string}`;
export type WriteQualifiedName = `${string}:write:${string}`;

// Phantom member only carries the types; it is never set at runtime.
export type QueryContract<TPayload, TResult> = {
  readonly kind: "query";
  readonly qualifiedName: QueryQualifiedName;
  readonly [handlerContractTypes]?: { readonly payload: TPayload; readonly result: TResult };
};
export type WriteContract<TPayload, TData> = {
  readonly kind: "write";
  readonly qualifiedName: WriteQualifiedName;
  readonly [handlerContractTypes]?: { readonly payload: TPayload; readonly result: TData };
};
export type HandlerContract = QueryContract<unknown, unknown> | WriteContract<unknown, unknown>;

export function queryContract<TPayload, TResult>(
  qualifiedName: QueryQualifiedName,
): QueryContract<TPayload, TResult> {
  return { kind: "query", qualifiedName };
}

export function writeContract<TPayload, TData>(
  qualifiedName: WriteQualifiedName,
): WriteContract<TPayload, TData> {
  return { kind: "write", qualifiedName };
}

export function isWriteQualifiedName(name: string): name is WriteQualifiedName {
  return name.includes(":write:");
}

export function qualifiedNameOf(target: string | HandlerContract): string {
  return typeof target === "string" ? target : target.qualifiedName;
}

// Overloaded call shapes; Rest = trailing args after payload (user, tenantId, ...).
export type ContractQuery<Rest extends readonly unknown[] = []> = {
  <TPayload, TResult>(
    contract: QueryContract<TPayload, TResult>,
    payload: NoInfer<TPayload>,
    ...rest: Rest
  ): Promise<TResult>;
  (qualifiedName: string, payload: unknown, ...rest: Rest): Promise<unknown>;
};
export type ContractWrite<Rest extends readonly unknown[] = []> = {
  <TPayload, TData>(
    contract: WriteContract<TPayload, TData>,
    payload: NoInfer<TPayload>,
    ...rest: Rest
  ): Promise<WriteResult<TData>>;
  (qualifiedName: string, payload: unknown, ...rest: Rest): Promise<WriteResult>;
};
export type ContractQueryAs = {
  <TPayload, TResult>(
    user: SessionUser,
    contract: QueryContract<TPayload, TResult>,
    payload: NoInfer<TPayload>,
  ): Promise<TResult>;
  (user: SessionUser, qualifiedName: string, payload: unknown): Promise<unknown>;
};
export type ContractWriteAs = {
  <TPayload, TData>(
    user: SessionUser,
    contract: WriteContract<TPayload, TData>,
    payload: NoInfer<TPayload>,
  ): Promise<WriteResult<TData>>;
  (user: SessionUser, qualifiedName: string, payload: unknown): Promise<WriteResult>;
};
