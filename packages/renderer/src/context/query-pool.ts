export type QuerySlot = { readonly release: () => void };

type PoolWaiter = {
  readonly limit: number;
  readonly grant: (slot: QuerySlot) => void;
};

type Pool = { running: number; readonly waiting: PoolWaiter[] };

export type QueryPools = {
  /** Resolves with a slot once fewer than `limit` requests of this query name
   *  run, or with null when `signal` aborts first (a waiter that gives up
   *  never holds a slot). The caller must release a granted slot exactly once. */
  readonly acquire: (name: string, limit: number, signal: AbortSignal) => Promise<QuerySlot | null>;
};

export function createQueryPools(): QueryPools {
  const pools = new Map<string, Pool>();

  const poolFor = (name: string): Pool => {
    const existing = pools.get(name);
    if (existing) return existing;
    const created: Pool = { running: 0, waiting: [] };
    pools.set(name, created);
    return created;
  };

  const makeSlot = (name: string, pool: Pool): QuerySlot => {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        pool.running -= 1;
        drain(name, pool);
      },
    };
  };

  const drain = (name: string, pool: Pool): void => {
    const next = pool.waiting[0];
    if (next !== undefined && pool.running < next.limit) {
      pool.waiting.shift();
      pool.running += 1;
      next.grant(makeSlot(name, pool));
    }
    if (pool.running === 0 && pool.waiting.length === 0) pools.delete(name);
  };

  return {
    acquire: (name, limit, signal) => {
      if (signal.aborted) return Promise.resolve(null);
      const pool = poolFor(name);
      if (pool.waiting.length === 0 && pool.running < limit) {
        pool.running += 1;
        return Promise.resolve(makeSlot(name, pool));
      }
      return new Promise<QuerySlot | null>((resolve) => {
        const waiter: PoolWaiter = {
          limit,
          grant: (slot) => {
            signal.removeEventListener("abort", onAbort);
            resolve(slot);
          },
        };
        const onAbort = (): void => {
          const index = pool.waiting.indexOf(waiter);
          if (index >= 0) pool.waiting.splice(index, 1);
          resolve(null);
          drain(name, pool);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pool.waiting.push(waiter);
      });
    },
  };
}
