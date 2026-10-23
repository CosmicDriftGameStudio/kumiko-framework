// Test jobs await the gate so they stay active until the test releases them;
// cap checks then never race a handler's sleep.
export type ReleaseGate = {
  readonly hold: () => void;
  readonly release: () => void;
  readonly wait: () => Promise<void>;
};

export function createReleaseGate(): ReleaseGate {
  let current: Promise<void> = Promise.resolve();
  let open: () => void = () => {};
  return {
    hold: () => {
      current = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
    wait: () => current,
  };
}
