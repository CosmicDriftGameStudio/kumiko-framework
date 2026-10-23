import { AsyncLocalStorage } from "node:async_hooks";

// Bun.SQL lets savepoints on one transaction overlap, so a RELEASE aborts it with 3B001.
// Work started inside a running unit nests on the server and gets its own chain.

type WorkChain = { tail: Promise<void> };
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
  if (nested) return nested;
  const root = rootChains.get(transactionKey);
  if (root) return root;
  const created: WorkChain = { tail: Promise.resolve() };
  rootChains.set(transactionKey, created);
  return created;
}

async function runOnChain<T>(transactionKey: HandleKey, work: () => Promise<T>): Promise<T> {
  const chain = chainFor(transactionKey);
  const previous = chain.tail;
  let release = (): void => {};
  chain.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const scope = new Map(nestedChainsInScope.getStore());
    scope.set(transactionKey, { tail: Promise.resolve() });
    return await nestedChainsInScope.run(scope, work);
  } finally {
    release();
  }
}

export function runSerializedOnTransaction<T>(
  transactionHandle: HandleKey,
  work: () => Promise<T>,
): Promise<T> {
  return runOnChain(transactionKeyOf(transactionHandle), work);
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
