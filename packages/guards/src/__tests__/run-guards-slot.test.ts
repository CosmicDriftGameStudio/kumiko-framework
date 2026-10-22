import { describe, expect, spyOn, test } from "bun:test";
import { Project } from "ts-morph";
import { runGuardsCli } from "../run-guards";

function slotSpy(): {
  acquireSlot: () => () => void;
  acquired: () => number;
  released: () => number;
} {
  let acquired = 0;
  let released = 0;
  return {
    acquireSlot: () => {
      acquired++;
      return () => {
        released++;
      };
    },
    acquired: () => acquired,
    released: () => released,
  };
}

describe("runGuardsCli — guard run slot", () => {
  test("the slot is released when building the project throws", () => {
    const slot = slotSpy();
    expect(() =>
      runGuardsCli([], {
        acquireSlot: slot.acquireSlot,
        buildProject: () => {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
    expect(slot.acquired()).toBe(1);
    expect(slot.released()).toBe(1);
  });

  test("flag errors take no slot", () => {
    const slot = slotSpy();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(runGuardsCli(["--bogus-flag"], { acquireSlot: slot.acquireSlot })).toBe(1);
      expect(runGuardsCli(["--guard=x"], { acquireSlot: slot.acquireSlot })).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
    expect(slot.acquired()).toBe(0);
  });

  test("--explain takes no slot", () => {
    const slot = slotSpy();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        runGuardsCli(["--explain"], {
          acquireSlot: slot.acquireSlot,
          buildProject: () => new Project({ useInMemoryFileSystem: true }),
        }),
      ).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
    expect(slot.acquired()).toBe(0);
  });
});
