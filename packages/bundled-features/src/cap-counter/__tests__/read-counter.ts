import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { CapCounterQueries } from "../constants.ts";

type CounterReaderStack = Pick<TestStack, "http">;

export type CounterRow = Record<string, unknown>;

export function fetchCounterRow(
  stack: CounterReaderStack,
  user: SessionUser,
  capName: string,
  periodStartIso: string,
): Promise<CounterRow | null> {
  return stack.http.queryOk<CounterRow | null>(
    CapCounterQueries.getCounter,
    { capName, periodStartIso },
    user,
  );
}

export async function fetchCounterValue(
  stack: CounterReaderStack,
  user: SessionUser,
  capName: string,
  periodStartIso: string,
): Promise<number | undefined> {
  const row = await fetchCounterRow(stack, user, capName, periodStartIso);
  if (row === null) return undefined;
  const value = row["value"];
  if (typeof value !== "number") {
    throw new Error(`counter value is not a number: ${typeof value}`);
  }
  return value;
}
