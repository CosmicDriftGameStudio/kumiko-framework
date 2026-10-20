export type BurstResult = {
  readonly responses: readonly Response[];
  readonly statuses: Readonly<Record<number, number>>;
};

export async function burst(
  stack: { readonly dbPoolMax: number },
  count: number,
  request: (index: number) => Promise<Response>,
): Promise<BurstResult> {
  if (count > stack.dbPoolMax) {
    throw new Error(
      `burst of ${count} exceeds dbPoolMax ${stack.dbPoolMax}: extra requests queue on the pool and a barrier inside the handler deadlocks; raise TestStackOptions.dbPoolMax or lower the count`,
    );
  }
  const responses = await Promise.all(Array.from({ length: count }, (_, index) => request(index)));
  const statuses: Record<number, number> = {};
  for (const response of responses) {
    statuses[response.status] = (statuses[response.status] ?? 0) + 1;
  }
  return { responses, statuses };
}
