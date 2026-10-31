import { InternalError } from "../errors/index.ts";
import {
  applyRowLevelSecurityScope,
  buildRowLevelSecurityScopeQuery,
} from "./queries/rls-scope.ts";
import type { RowLevelSecurityMode } from "./render-rls-ddl.ts";
import {
  activeRowLevelSecurityScope,
  innerOfScopedRunner,
  type RowLevelSecurityScope,
  rowLevelSecurityScopeKey,
  runInCapturedRowLevelSecurityScope,
} from "./row-level-security-scope.ts";
import { registerRunnerProxyTarget } from "./transaction-serialization.ts";

const enforcedHandles = new WeakSet<object>();

// Differs from every scope key, so the next statement always re-applies its scope.
const UNKNOWN_SCOPE_KEY = "unknown";

type TransactionScopeState = {
  applied: string;
  tail: Promise<unknown>;
};

const noop = (): void => {};

function isHandle(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

export function rowLevelSecurityModeOf(db: unknown): RowLevelSecurityMode {
  let current: unknown = db;
  while (isHandle(current)) {
    if (enforcedHandles.has(current)) return "on";
    current = innerOfScopedRunner(current);
  }
  return "off";
}

function callMethod(target: object, name: string, args: readonly unknown[]): unknown {
  return Reflect.apply(Reflect.get(target, name, target), target, args);
}

// Tagged-template calls need the real driver object as `this`.
function applyOnTarget(target: object, args: readonly unknown[]): unknown {
  if (typeof target !== "function") {
    throw new TypeError("row-level-security proxy applied on a non-callable handle");
  }
  return Reflect.apply(target, target, args);
}

function isTaggedTemplateCall(args: readonly unknown[]): boolean {
  const first = args[0];
  return Array.isArray(first) && "raw" in first;
}

// Sql methods that send statements on a connection this wrapper cannot align per statement.
const UNSUPPORTED_ON_ENFORCED_HANDLE: ReadonlySet<PropertyKey> = new Set([
  "reserve",
  "beginDistributed",
  "commitDistributed",
  "rollbackDistributed",
]);

function enqueue<T>(state: TransactionScopeState, unit: () => Promise<T>): Promise<T> {
  const result = state.tail.then(unit);
  state.tail = result.then(noop, noop);
  return result;
}

// The driver may run the callback outside the caller's async context, so the captured scope is re-entered.
function withCapturedCallback(
  args: readonly unknown[],
  wrap: (handle: object) => unknown,
): unknown[] {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") return [...args];
  const captured = activeRowLevelSecurityScope();
  return [
    ...args.slice(0, -1),
    (handle: object) => runInCapturedRowLevelSecurityScope(captured, () => callback(wrap(handle))),
  ];
}

function alignedStatement(
  target: object,
  state: TransactionScopeState,
  run: () => unknown,
): Promise<unknown> {
  const desired = activeRowLevelSecurityScope();
  return enqueue(state, async () => {
    await alignScope(target, state, desired);
    return run();
  });
}

function transactionHandleProxy<T extends object>(handle: T, state: TransactionScopeState): T {
  const proxy = new Proxy(handle, {
    apply(target, _thisArg, args) {
      // Helper calls such as sql(rows) or sql("ident") build fragments and send nothing.
      if (!isTaggedTemplateCall(args)) return applyOnTarget(target, args);
      return alignedStatement(target, state, () => applyOnTarget(target, args));
    },
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (UNSUPPORTED_ON_ENFORCED_HANDLE.has(prop)) {
        return (
          // guard:dup-ok a throw-only stub; the message is its whole content
          () => {
            throw new InternalError({
              message: `row-level security: ${String(prop)} is not supported on an enforced transaction handle`,
            });
          }
        );
      }
      if (prop === "unsafe" || prop === "file") {
        return (...args: unknown[]) =>
          alignedStatement(target, state, () => callMethod(target, prop, args));
      }
      if (prop === "savepoint") {
        // A released or rolled-back savepoint reverts the transaction-local settings made inside it.
        return async (...args: unknown[]) => {
          try {
            return await callMethod(
              target,
              "savepoint",
              withCapturedCallback(args, (spHandle) => transactionHandleProxy(spHandle, state)),
            );
          } finally {
            state.applied = UNKNOWN_SCOPE_KEY;
          }
        };
      }
      return value.bind(target);
    },
  });
  enforcedHandles.add(proxy);
  registerRunnerProxyTarget(proxy, handle);
  return proxy;
}

async function alignScope(
  handle: object,
  state: TransactionScopeState,
  desired: RowLevelSecurityScope | undefined,
): Promise<void> {
  const key = rowLevelSecurityScopeKey(desired);
  // skip: scope already applied on this connection
  if (key === state.applied) return;
  state.applied = UNKNOWN_SCOPE_KEY;
  await applyRowLevelSecurityScope(handle, desired);
  state.applied = key;
}

function newTransactionState(): TransactionScopeState {
  return { applied: rowLevelSecurityScopeKey(undefined), tail: Promise.resolve() };
}

const templateOf = (strings: TemplateStringsArray): TemplateStringsArray => strings;
// Tagged-template statements pipeline behind each other; unsafe() without parameters is sent as a
// simple query that waits for its own result first (measured 4.1 vs 2.4 roundtrips).
const BEGIN_TEMPLATE = templateOf`BEGIN`;
const COMMIT_TEMPLATE = templateOf`COMMIT`;

// Bun queries are lazy: they go out when started, so each one is started explicitly, in order,
// to pipeline BEGIN, the scope and the statement on one connection.
function startQuery(build: () => unknown): Promise<unknown> {
  try {
    const query = build();
    if (isHandle(query) && typeof Reflect.get(query, "execute") === "function") {
      callMethod(query, "execute", []);
    }
    return Promise.resolve(query);
  } catch (error) {
    // A statement that cannot be built must not stop COMMIT from being queued behind BEGIN.
    return Promise.reject(error);
  }
}

// COMMIT is always queued and the connection is released only after all four settled, so it never
// returns to the pool inside an open transaction; COMMIT after a failed statement rolls back.
async function pipelinedScopedTransaction(
  pool: object,
  scope: RowLevelSecurityScope | undefined,
  run: (conn: object) => unknown,
): Promise<unknown> {
  const conn = await callMethod(pool, "reserve", []);
  if (!isHandle(conn)) {
    throw new InternalError({
      message: "row-level security: pool.reserve() returned no connection",
    });
  }
  try {
    const begin = startQuery(() => applyOnTarget(conn, [BEGIN_TEMPLATE]));
    const setScope = startQuery(() => buildRowLevelSecurityScopeQuery(conn, scope));
    const statement = startQuery(() => run(conn));
    const commit = startQuery(() => applyOnTarget(conn, [COMMIT_TEMPLATE]));
    const [beginResult, scopeResult, statementResult, commitResult] = await Promise.allSettled([
      begin,
      setScope,
      statement,
      commit,
    ]);
    // Without BEGIN or the scope the statement ran unscoped (fails closed) but is not a success.
    if (beginResult.status === "rejected") throw beginResult.reason;
    if (scopeResult.status === "rejected") throw scopeResult.reason;
    if (statementResult.status === "rejected") throw statementResult.reason;
    if (commitResult.status === "rejected") throw commitResult.reason;
    return statementResult.value;
  } finally {
    callMethod(conn, "release", []);
  }
}

// A pool statement under a scope runs as its own short transaction; without a scope it passes
// through and the policies see no tenant (fail closed), so DDL like CONCURRENTLY keeps working.
export function enforceRowLevelSecurity<T extends object>(pool: T): T {
  const inScopedTransaction = (run: (conn: object) => unknown): Promise<unknown> =>
    pipelinedScopedTransaction(pool, activeRowLevelSecurityScope(), run);
  const proxy = new Proxy(pool, {
    apply(target, _thisArg, args) {
      if (!isTaggedTemplateCall(args) || activeRowLevelSecurityScope() === undefined) {
        return applyOnTarget(target, args);
      }
      return inScopedTransaction((conn) => applyOnTarget(conn, args));
    },
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "unsafe" || prop === "file") {
        return (...args: unknown[]) => {
          if (activeRowLevelSecurityScope() === undefined) return callMethod(target, prop, args);
          if (prop === "file") {
            // Bun sends file() only after its async file read, i.e. after the pipelined COMMIT.
            const scope = activeRowLevelSecurityScope();
            return callMethod(target, "begin", [
              async (tx: object) => {
                await applyRowLevelSecurityScope(tx, scope);
                return callMethod(tx, "file", args);
              },
            ]);
          }
          return inScopedTransaction((conn) => callMethod(conn, prop, args));
        };
      }
      if (prop === "begin" || prop === "transaction") {
        return (...args: unknown[]) =>
          callMethod(
            target,
            prop,
            withCapturedCallback(args, (tx) => transactionHandleProxy(tx, newTransactionState())),
          );
      }
      return value.bind(target);
    },
  });
  enforcedHandles.add(proxy);
  registerRunnerProxyTarget(proxy, pool);
  return proxy;
}
