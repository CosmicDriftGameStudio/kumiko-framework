import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  hasUnsavedInput,
  registerUnsavedInputSource,
  requestLeave,
  setLeaveConfirmer,
} from "../leave-guard.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("leave guard registry", () => {
  test("reports unsaved input while any registered source is dirty", () => {
    let secondDirty = false;
    cleanups.push(registerUnsavedInputSource(() => false));
    cleanups.push(registerUnsavedInputSource(() => secondDirty));
    expect(hasUnsavedInput()).toBe(false);
    secondDirty = true;
    expect(hasUnsavedInput()).toBe(true);
  });

  test("unregistering removes the source", () => {
    const unregister = registerUnsavedInputSource(() => true);
    expect(hasUnsavedInput()).toBe(true);
    unregister();
    expect(hasUnsavedInput()).toBe(false);
  });

  test("requestLeave proceeds immediately when nothing is dirty", () => {
    const confirmer = mock(() => {});
    cleanups.push(setLeaveConfirmer(confirmer));
    const proceed = mock(() => {});
    requestLeave(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(confirmer).not.toHaveBeenCalled();
  });

  test("requestLeave defers to the confirmer when dirty and leaves the decision to it", () => {
    let decision: { proceed: () => void; cancel: () => void } | undefined;
    cleanups.push(
      setLeaveConfirmer((d) => {
        decision = d;
      }),
    );
    cleanups.push(registerUnsavedInputSource(() => true));
    const proceed = mock(() => {});
    const cancel = mock(() => {});
    requestLeave(proceed, cancel);
    expect(proceed).not.toHaveBeenCalled();
    decision?.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
    decision?.proceed();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  test("without a mounted dialog host a dirty leave is not blocked", () => {
    cleanups.push(registerUnsavedInputSource(() => true));
    const proceed = mock(() => {});
    requestLeave(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
