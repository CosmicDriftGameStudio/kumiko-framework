const GIB = 1024 ** 3;

// Pool 3 peaked at 15.5 GB on the 16 GB CI runner (Biome, tsc and the guard suites at once) with
// under 0.5 GB left, so machines of that size run two fast steps at a time.
const LOW_MEMORY_MACHINE_BYTES = 24 * GIB;
const LOW_MEMORY_FAST_POOL_CAP = 2;

export type FastPoolInputs = {
  readonly override: string | undefined;
  readonly cores: number;
  readonly loadAverage1Min: number;
  readonly totalMemoryBytes: number;
};

// Fast checks are CPU-bound (tsc, ts-morph guards). A fixed pool=6 thrashes
// wherever spare CPU < 6 — the 1-CPU CI runner, or a loaded dev box (4 parallel
// sessions) — inflating every step 5-6×. Size to *currently free* capacity
// (cores − 1-min load), not raw core count, so a busy machine doesn't
// oversubscribe. Override with KUMIKO_FAST_POOL.
export function computeFastPool(inputs: FastPoolInputs): number {
  const overridden = Number(inputs.override);
  if (overridden) return overridden;
  const cpuPool = Math.max(
    1,
    Math.min(inputs.cores - 1, Math.round(inputs.cores - inputs.loadAverage1Min)),
  );
  return inputs.totalMemoryBytes < LOW_MEMORY_MACHINE_BYTES
    ? Math.min(cpuPool, LOW_MEMORY_FAST_POOL_CAP)
    : cpuPool;
}
