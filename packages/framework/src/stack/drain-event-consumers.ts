import type { DbConnection } from "../db";
import { getEventsHighWaterMark } from "../event-store";
import { type ConsumerRecoveryState, getConsumerState } from "../pipeline";
import type { TestStack } from "./test-stack";

const DEFAULT_MAX_PASSES = 25;

// Drives eventDispatcher.runOnce() until every named consumer has caught up
// to the events high-water mark captured at call time. No "no progress ⇒
// throw" shortcut: a pass can legitimately advance zero cursors even though
// work remains — runOnce's FOR UPDATE SKIP LOCKED lets a concurrent pass
// (the test stack's own 50ms poll timer) hold a consumer's row, and a
// consumer coming off a thrown-pass backoff sits idle until its retryAtMs
// elapses. A bounded pass budget tolerates both without pretending to detect
// "stuck" from a single empty pass. The target is a snapshot: events a
// consumer's own handler writes afterward (cascades) are not waited on.
export async function drainEventConsumers(
  stack: Pick<TestStack, "db" | "eventDispatcher">,
  consumerNames: readonly [string, ...string[]],
  options?: { readonly maxPasses?: number },
): Promise<void> {
  const { db, eventDispatcher } = stack;
  if (!eventDispatcher) {
    throw new Error(
      "drainEventConsumers: stack.eventDispatcher is undefined — no system consumer or " +
        "multiStreamProjection is wired for this stack.",
    );
  }
  const maxPasses = options?.maxPasses ?? DEFAULT_MAX_PASSES;
  const target = await getEventsHighWaterMark(db);

  for (let pass = 0; pass < maxPasses; pass++) {
    await eventDispatcher.runOnce();
    const states = await loadConsumerStates(db, consumerNames);
    // skip: every named consumer has already caught up to the target snapshot — the
    // remaining budgeted passes are unnecessary, not a swallowed error.
    if (states.every((state) => state.lastProcessedEventId >= target)) return;
    if (pass === maxPasses - 1) {
      throw budgetExhaustedError(maxPasses, target, states);
    }
  }
}

async function loadConsumerStates(
  db: DbConnection,
  consumerNames: readonly [string, ...string[]],
): Promise<readonly ConsumerRecoveryState[]> {
  return Promise.all(
    consumerNames.map(async (name) => {
      const state = await getConsumerState(db, name);
      if (!state) {
        throw new Error(`drainEventConsumers: consumer "${name}" not registered or per-instance`);
      }
      return state;
    }),
  );
}

function budgetExhaustedError(
  maxPasses: number,
  target: bigint,
  states: readonly ConsumerRecoveryState[],
): Error {
  const unfinished = states.filter((state) => state.lastProcessedEventId < target);
  const lines = unfinished.map(
    (state) =>
      `  ${state.name}: lastProcessedEventId=${state.lastProcessedEventId} target=${target} ` +
      `status=${state.status} attempts=${state.attempts} lastError=${state.lastError ?? "null"}`,
  );
  return new Error(
    `drainEventConsumers: budget of ${maxPasses} passes exhausted, consumers still behind target:\n` +
      lines.join("\n"),
  );
}
