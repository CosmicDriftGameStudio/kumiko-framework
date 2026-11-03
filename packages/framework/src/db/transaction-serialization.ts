import { AsyncLocalStorage } from "node:async_hooks";

// Bun.SQL lets savepoints on one transaction overlap, so a RELEASE aborts it with 3B001.
// Work started inside a running unit nests on the server and gets its own chain.
// A plain statement issued outside every unit waits for the units queued ahead of it: on the
// server it would otherwise land inside the open savepoint and be rolled back with it.

type WorkChain = { tail: Promise<void>; active: boolean; pending: number };
type HandleKey = object;

const runnerProxyTargets = new WeakMap<HandleKey, HandleKey>();
const savepointTransactionKeys = new WeakMap<HandleKey, HandleKey>();
const rootChains = new WeakMap<HandleKey, WorkChain>();
const nestedChainsInScope = new AsyncLocalStorage<ReadonlyMap<HandleKey, WorkChain>>();

function isHandleKey(value: unknown): value is HandleKey {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

export function registerRunnerProxyTarget(proxy: HandleKey, target: HandleKey): void {
  runnerProxyTargets.set(proxy, target);
}

function driverHandleOf(handle: HandleKey): HandleKey {
  let current = handle;
  let target = runnerProxyTargets.get(current);
  while (target) {
    current = target;
    target = runnerProxyTargets.get(current);
  }
  return current;
}

function transactionKeyOf(handle: HandleKey): HandleKey {
  const driverHandle = driverHandleOf(handle);
  return savepointTransactionKeys.get(driverHandle) ?? driverHandle;
}

function chainFor(transactionKey: HandleKey): WorkChain {
  const nested = nestedChainsInScope.getStore()?.get(transactionKey);
  // Background tasks started inside a unit outlive it and inherit its scope; once the unit has
  // finished their work must queue on the root chain again.
  if (nested?.active) return nested;
  const root = rootChains.get(transactionKey);
  if (root) return root;
  const created: WorkChain = { tail: Promise.resolve(), active: true, pending: 0 };
  rootChains.set(transactionKey, created);
  return created;
}

async function runOnChain<T>(transactionKey: HandleKey, work: () => Promise<T>): Promise<T> {
  const chain = chainFor(transactionKey);
  const previous = chain.tail;
  chain.pending++;
  let release = (): void => {};
  chain.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const nestedChain: WorkChain = { tail: Promise.resolve(), active: true, pending: 0 };
  try {
    const scope = new Map(nestedChainsInScope.getStore());
    scope.set(transactionKey, nestedChain);
    return await nestedChainsInScope.run(scope, work);
  } finally {
    nestedChain.active = false;
    chain.pending--;
    release();
  }
}

export function openSerializedSavepoint<T>(
  transactionHandle: HandleKey & {
    savepoint: <R>(fn: (sp: unknown) => Promise<R>) => Promise<R>;
  },
  fn: (sp: unknown) => Promise<T>,
): Promise<T> {
  const transactionKey = transactionKeyOf(transactionHandle);
  return runOnChain(transactionKey, () =>
    transactionHandle.savepoint((sp) => {
      if (isHandleKey(sp)) savepointTransactionKeys.set(driverHandleOf(sp), transactionKey);
      return fn(sp);
    }),
  );
}

// Runs a statement on a transaction handle. Inside a running unit (or with no unit queued) it
// goes straight to the driver; otherwise it queues behind the pending units.
export async function runStatementBehindPendingUnits<T>(
  handle: HandleKey,
  statement: () => T,
): Promise<Awaited<T>> {
  const transactionKey = transactionKeyOf(handle);
  if (nestedChainsInScope.getStore()?.get(transactionKey)?.active) return await statement();
  if ((rootChains.get(transactionKey)?.pending ?? 0) === 0) return await statement();
  return runOnChain(transactionKey, async (): Promise<Awaited<T>> => await statement());
}
