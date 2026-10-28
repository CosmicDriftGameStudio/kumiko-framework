import { describe, expect, test } from "bun:test";
import { createBootReport } from "../boot-report.ts";
import { BootValidationError } from "../boot-rule.ts";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

describe("createBootReport", () => {
  test("a crash without violations is rethrown as the original object", () => {
    const report = createBootReport();
    const crash = new TypeError("undefined is not an object");
    expect(
      report.check("someCheck", "shop", () => {
        throw crash;
      }),
    ).toBe(false);
    expect(thrownBy(() => report.endPhase())).toBe(crash);
  });

  test("only the first crash is kept", () => {
    const report = createBootReport();
    const first = new RangeError("first");
    report.check("a", undefined, () => {
      throw first;
    });
    report.check("b", undefined, () => {
      throw new TypeError("second");
    });
    expect(thrownBy(() => report.finish())).toBe(first);
  });

  test("a crash next to a violation is dropped in favour of the violation", () => {
    const report = createBootReport();
    report.check("a", undefined, () => {
      throw new TypeError("follow-up");
    });
    report.check("validateThing", "shop", () => {
      throw new Error("real problem");
    });
    const error = thrownBy(() => report.endPhase());
    if (!(error instanceof BootValidationError)) throw new Error("expected BootValidationError");
    expect(error.violations).toEqual([
      {
        ruleId: "unclassified/validateThing",
        check: "validateThing",
        feature: "shop",
        message: "real problem",
      },
    ]);
  });

  test("a non-Error throw counts as a crash", () => {
    const report = createBootReport();
    report.check("a", undefined, () => {
      throw "plain string";
    });
    expect(thrownBy(() => report.endPhase())).toBe("plain string");
  });

  test("endPhase without violations or crash does not throw", () => {
    const report = createBootReport();
    expect(report.check("ok", undefined, () => {})).toBe(true);
    expect(() => report.endPhase()).not.toThrow();
    expect(() => report.finish()).not.toThrow();
  });
});

describe("BootValidationError", () => {
  test("header is present for a single violation and singular", () => {
    const error = new BootValidationError([{ ruleId: "r/x", check: "x", message: "boom" }]);
    expect(error.message).toBe("Boot validation failed: 1 violation\n- [r/x] boom");
    expect(error.name).toBe("BootValidationError");
  });

  test("lists every violation and its fix", () => {
    const error = new BootValidationError([
      { ruleId: "r/a", check: "a", message: "first", fix: "do this" },
      { ruleId: "r/b", check: "b", message: "second" },
    ]);
    expect(error.message).toBe(
      "Boot validation failed: 2 violations\n- [r/a] first\n  Fix: do this\n- [r/b] second",
    );
  });
});
