import type { JobRunnerRef } from "@cosmicdrift/kumiko-types/handlers";
import type { HandlerContext } from "../engine/types/index.ts";
import { memberResolutionReadOnlyDenied } from "../errors/member-resolution.ts";

import {
  denyingJobRunnerProxy,
  dropOutsideTransaction,
  withoutNotifyFactories,
} from "./handler-context-phase-denials.ts";
import { asTypedAppendEventFn } from "./typed-append-event.ts";

async function denyMemberResolutionWrite(): Promise<never> {
  throw memberResolutionReadOnlyDenied();
}

function throwMemberResolutionDenied(): never {
  throw memberResolutionReadOnlyDenied();
}

// Allowlist (not denylist): a method added to the target later stays denied
// until someone decides it is read-only.
function allowlistedReadOnlyProxy<T extends object>(
  target: T,
  allowedMethods: ReadonlySet<string>,
): T {
  return new Proxy(target, {
    get(inner, prop) {
      if (typeof prop === "string" && allowedMethods.has(prop)) {
        const method: unknown = Reflect.get(inner, prop, inner);
        return typeof method === "function" ? method.bind(inner) : method;
      }
      // Symbol reads and "then" come from await/Promise.resolve/inspect, not from handler code.
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw memberResolutionReadOnlyDenied();
    },
  });
}

const MEMBER_READ_SEARCH_METHODS: ReadonlySet<string> = new Set(["search"]);
const MEMBER_READ_ENTITY_CACHE_METHODS: ReadonlySet<string> = new Set(["get", "mget"]);
const MEMBER_READ_REDIS_METHODS: ReadonlySet<string> = new Set([
  "get",
  "mget",
  "exists",
  "ttl",
  "pttl",
  "strlen",
  "type",
  "hget",
  "hmget",
  "hgetall",
  "hexists",
  "hlen",
  "sismember",
  "smembers",
  "scard",
  "llen",
  "lrange",
  "zscore",
  "zcard",
  "zrange",
]);

function readOnlyServices(services: HandlerContext["services"]): HandlerContext["services"] {
  const { searchAdapter, redis, entityCache, jobRunner } = services;
  // A read as a member gets no file storage, no notify factory and no job runner; the read-only
  // proxies keep the rest. The resolver and factories would reopen what files/notify close.
  const {
    files: _files,
    derivatives: _derivatives,
    _fileProviderResolver: _resolver,
    ...kept
  } = withoutNotifyFactories(services);
  const runner: JobRunnerRef | undefined = jobRunner && denyingJobRunnerProxy();
  return {
    ...kept,
    ...(runner && { jobRunner: runner }),
    ...(searchAdapter && {
      searchAdapter: allowlistedReadOnlyProxy(searchAdapter, MEMBER_READ_SEARCH_METHODS),
    }),
    ...(redis && { redis: allowlistedReadOnlyProxy(redis, MEMBER_READ_REDIS_METHODS) }),
    ...(entityCache && {
      entityCache: allowlistedReadOnlyProxy(entityCache, MEMBER_READ_ENTITY_CACHE_METHODS),
    }),
  };
}

// Every write/side-effect surface throws, so "no writeAsMember" holds even
// if a handler tries ctx.dispatch.write directly on a resolved member principal.
// Deliberately open: `db` (guarded by the READ ONLY transaction + memberReadOnly grant),
// and read-only methods of searchAdapter / redis / entityCache (allowlisted).
export function applyMemberResolutionReadOnly(handlerContext: HandlerContext): HandlerContext {
  // `db` stays open — executeQuery runs the whole handler in a Postgres READ ONLY
  // transaction, and its `memberReadOnly` grant denies every raw-runner handout.
  dropOutsideTransaction(handlerContext);
  const { systemDb: _systemDb, crossTenantReads: _crossTenantReads, ...kept } = handlerContext;
  return {
    ...kept,
    dispatch: {
      ...handlerContext.dispatch,
      write: denyMemberResolutionWrite,
      writeAs: denyMemberResolutionWrite,
      // A resolved member cannot switch identity either — the target would get a normal, writable context.
      queryAs: denyMemberResolutionWrite,
      queryAsMember: denyMemberResolutionWrite,
    },
    events: {
      ...handlerContext.events,
      append: asTypedAppendEventFn(denyMemberResolutionWrite),
      unsafeAppend: denyMemberResolutionWrite,
      tryAppend: denyMemberResolutionWrite,
      fetchForWriting: denyMemberResolutionWrite,
      archive: denyMemberResolutionWrite,
      restore: denyMemberResolutionWrite,
      snapshot: denyMemberResolutionWrite,
    },
    auth: { ...handlerContext.auth, resolveActiveMembership: denyMemberResolutionWrite },
    // A read as a member gets no system-scope DB, preSave pipeline or file storage.
    lifecycle: {
      afterCommit: throwMemberResolutionDenied,
      afterRollback: throwMemberResolutionDenied,
      ...(handlerContext.lifecycle.signal && { signal: handlerContext.lifecycle.signal }),
    },
    tenants: {
      ...(handlerContext.tenants.config && { config: handlerContext.tenants.config }),
    },
    services: readOnlyServices(handlerContext.services),
    ...(handlerContext.notify && { notify: denyMemberResolutionWrite }),
  };
}
