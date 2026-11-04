import { describe, expect, test } from "bun:test";
import { createIdleCloser } from "../idle-closer";

function setup() {
  const timers = new Map<number, () => void>();
  let nextId = 0;
  let closed = 0;
  const idleCloser = createIdleCloser(
    () => {
      closed += 1;
    },
    (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return () => timers.delete(id);
    },
  );
  const fire = () => {
    for (const fn of [...timers.values()]) fn();
    timers.clear();
  };
  return { idleCloser, timers, fire, closedCount: () => closed };
}

describe("createIdleCloser", () => {
  test("closes after the idle timeout once the last render ended", () => {
    const { idleCloser, fire, closedCount } = setup();
    idleCloser.begin();
    idleCloser.end(1000);
    expect(closedCount()).toBe(0);
    fire();
    expect(closedCount()).toBe(1);
  });

  test("no timer while a render is running", () => {
    const { idleCloser, timers } = setup();
    idleCloser.begin();
    expect(timers.size).toBe(0);
  });

  test("a new render before expiry cancels the timer", () => {
    const { idleCloser, timers, fire, closedCount } = setup();
    idleCloser.begin();
    idleCloser.end(1000);
    idleCloser.begin();
    expect(timers.size).toBe(0);
    fire();
    expect(closedCount()).toBe(0);
  });

  test("parallel renders arm the timer only after the last one", () => {
    const { idleCloser, timers, fire, closedCount } = setup();
    idleCloser.begin();
    idleCloser.begin();
    idleCloser.end(1000);
    expect(timers.size).toBe(0);
    idleCloser.end(1000);
    expect(timers.size).toBe(1);
    fire();
    expect(closedCount()).toBe(1);
  });

  test("cancel drops a pending timer", () => {
    const { idleCloser, timers } = setup();
    idleCloser.begin();
    idleCloser.end(1000);
    idleCloser.cancel();
    expect(timers.size).toBe(0);
  });
});
