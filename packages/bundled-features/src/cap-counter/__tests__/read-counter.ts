import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { CapCounterQueries } from "../constants.ts";

type CounterReaderStack = {
  readonly http: {
    readonly queryOk: <T = unknown>(
      type: string,
      payload: unknown,
      user: SessionUser,
    ) => Promise<T>;
  };
};

export type CounterRow = Record<string, unknown>;

export async function fetchCounterRow(
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
  const value = (await fetchCounterRow(stack, user, capName, periodStartIso))?.["value"];
  return typeof value === "number" ? value : undefined;
}
