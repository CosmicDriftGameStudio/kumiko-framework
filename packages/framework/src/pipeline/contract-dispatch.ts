import type {
  ContractQuery,
  ContractQueryAs,
  ContractWrite,
  ContractWriteAs,
  HandlerContract,
  QueryContract,
  WriteContract,
} from "@cosmicdrift/kumiko-types/handler-contract";
import { qualifiedNameOf } from "@cosmicdrift/kumiko-types/handler-contract";
import type { SessionUser, WriteResult } from "@cosmicdrift/kumiko-types/handlers";

export function bindContractQuery<Rest extends readonly unknown[]>(
  raw: (qualifiedName: string, payload: unknown, ...rest: Rest) => Promise<unknown>,
): ContractQuery<Rest> {
  function query<TPayload, TResult>(
    contract: QueryContract<TPayload, TResult>,
    payload: NoInfer<TPayload>,
    ...rest: Rest
  ): Promise<TResult>;
  function query(qualifiedName: string, payload: unknown, ...rest: Rest): Promise<unknown>;
  function query(
    target: string | HandlerContract,
    payload: unknown,
    ...rest: Rest
  ): Promise<unknown> {
    return raw(qualifiedNameOf(target), payload, ...rest);
  }
  return query;
}

export function bindContractWrite<Rest extends readonly unknown[]>(
  raw: (qualifiedName: string, payload: unknown, ...rest: Rest) => Promise<WriteResult>,
): ContractWrite<Rest> {
  function write<TPayload, TData>(
    contract: WriteContract<TPayload, TData>,
    payload: NoInfer<TPayload>,
    ...rest: Rest
  ): Promise<WriteResult<TData>>;
  function write(qualifiedName: string, payload: unknown, ...rest: Rest): Promise<WriteResult>;
  function write(
    target: string | HandlerContract,
    payload: unknown,
    ...rest: Rest
  ): Promise<WriteResult> {
    return raw(qualifiedNameOf(target), payload, ...rest);
  }
  return write;
}

export function bindContractQueryAs(
  raw: (user: SessionUser, qualifiedName: string, payload: unknown) => Promise<unknown>,
): ContractQueryAs {
  function queryAs<TPayload, TResult>(
    user: SessionUser,
    contract: QueryContract<TPayload, TResult>,
    payload: NoInfer<TPayload>,
  ): Promise<TResult>;
  function queryAs(user: SessionUser, qualifiedName: string, payload: unknown): Promise<unknown>;
  function queryAs(
    user: SessionUser,
    target: string | HandlerContract,
    payload: unknown,
  ): Promise<unknown> {
    return raw(user, qualifiedNameOf(target), payload);
  }
  return queryAs;
}

export function bindContractWriteAs(
  raw: (user: SessionUser, qualifiedName: string, payload: unknown) => Promise<WriteResult>,
): ContractWriteAs {
  function writeAs<TPayload, TData>(
    user: SessionUser,
    contract: WriteContract<TPayload, TData>,
    payload: NoInfer<TPayload>,
  ): Promise<WriteResult<TData>>;
  function writeAs(
    user: SessionUser,
    qualifiedName: string,
    payload: unknown,
  ): Promise<WriteResult>;
  function writeAs(
    user: SessionUser,
    target: string | HandlerContract,
    payload: unknown,
  ): Promise<WriteResult> {
    return raw(user, qualifiedNameOf(target), payload);
  }
  return writeAs;
}
