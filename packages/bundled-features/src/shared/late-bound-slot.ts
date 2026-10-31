// The unbind only clears the slot while it still holds this value, so a stack that stops later
// cannot unbind a newer stack sharing the same feature instance.
export type LateBoundSlot<TValue> = {
  readonly bind: (value: TValue) => () => void;
  readonly current: () => TValue | undefined;
};

export function createLateBoundSlot<TValue>(): LateBoundSlot<TValue> {
  let bound: TValue | undefined;
  return {
    bind: (value) => {
      bound = value;
      return () => {
        if (bound === value) bound = undefined;
      };
    },
    current: () => bound,
  };
}
