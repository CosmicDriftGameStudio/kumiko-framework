import { describe, expect, test } from "bun:test";
import { collectBootRuleViolations, createBootReport } from "../boot-report.ts";
import {
  BootRuleFailures,
  BootRuleViolation,
  BootValidationError,
  bootRuleError,
} from "../boot-rule.ts";

const RULE_A = { id: "demo/rule-a", summary: "Rule a.", fix: "Fix a." } as const;
const RULE_B = { id: "demo/rule-b", summary: "Rule b.", fix: "Fix b." } as const;

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
    expect(error.message).toBe(
      "Boot validation failed: 1 violation\n- [r/x] boom\n  Rule: agents/boot-rules.md#r-x",
    );
    expect(error.name).toBe("BootValidationError");
  });

  test("lists every violation and its fix", () => {
    const error = new BootValidationError([
      { ruleId: "r/a", check: "a", message: "first", fix: "do this" },
      { ruleId: "r/b", check: "b", message: "second" },
    ]);
    expect(error.message).toBe(
      "Boot validation failed: 2 violations\n- [r/a] first\n  Fix: do this\n  Rule: agents/boot-rules.md#r-a\n- [r/b] second\n  Rule: agents/boot-rules.md#r-b",
    );
  });

  test("unclassified violations carry no rule link", () => {
    const error = new BootValidationError([
      { ruleId: "unclassified/x", check: "x", message: "boom" },
    ]);
    expect(error.message).toBe("Boot validation failed: 1 violation\n- [unclassified/x] boom");
  });
});

describe("classified violations in createBootReport", () => {
  test("a BootRuleViolation keeps its rule id and carries the rule fix", () => {
    const report = createBootReport();
    report.check("validateThing", "shop", () => {
      throw bootRuleError(RULE_A, { message: "details" });
    });
    const error = thrownBy(() => report.endPhase());
    if (!(error instanceof BootValidationError)) throw new Error("expected BootValidationError");
    expect(error.violations).toEqual([
      {
        ruleId: "demo/rule-a",
        check: "validateThing",
        feature: "shop",
        message: "details",
        fix: "Fix a.",
      },
    ]);
  });

  test("BootRuleFailures are flattened into one violation each, nested ones too", () => {
    const report = createBootReport();
    report.check("validateThing", undefined, () => {
      throw new BootRuleFailures([
        new BootRuleViolation(RULE_A, "one"),
        new BootRuleFailures([new BootRuleViolation(RULE_B, "two"), new Error("three")]),
      ]);
    });
    const error = thrownBy(() => report.endPhase());
    if (!(error instanceof BootValidationError)) throw new Error("expected BootValidationError");
    expect(error.violations.map((v) => [v.ruleId, v.message])).toEqual([
      ["demo/rule-a", "one"],
      ["demo/rule-b", "two"],
      ["unclassified/validateThing", "three"],
    ]);
  });

  test("a nested BootValidationError contributes its violations", () => {
    const report = createBootReport();
    const nested = new BootValidationError([
      { ruleId: "demo/rule-a", check: "inner", message: "m" },
    ]);
    report.check("outer", undefined, () => {
      throw nested;
    });
    const error = thrownBy(() => report.endPhase());
    if (!(error instanceof BootValidationError)) throw new Error("expected BootValidationError");
    expect(error.violations).toEqual(nested.violations);
  });
});

describe("collectBootRuleViolations", () => {
  test("a single failure is rethrown as the same object", () => {
    const failure = new BootRuleViolation(RULE_A, "only");
    const error = thrownBy(() =>
      collectBootRuleViolations([1, 2], (n) => {
        if (n === 2) throw failure;
      }),
    );
    expect(error).toBe(failure);
  });

  test("several failures become one BootRuleFailures, nested failures flattened", () => {
    const first = new BootRuleViolation(RULE_A, "first");
    const second = new BootRuleViolation(RULE_B, "second");
    const third = new BootRuleViolation(RULE_A, "third");
    const error = thrownBy(() =>
      collectBootRuleViolations([1, 2], (n) => {
        if (n === 1) throw new BootRuleFailures([first, second]);
        throw third;
      }),
    );
    if (!(error instanceof BootRuleFailures)) throw new Error("expected BootRuleFailures");
    expect(error.failures).toEqual([first, second, third]);
    expect(error.message).toBe("first\nsecond\nthird");
  });

  test("a crash without failures is thrown", () => {
    const crash = new TypeError("bug");
    const error = thrownBy(() =>
      collectBootRuleViolations([1], () => {
        throw crash;
      }),
    );
    expect(error).toBe(crash);
  });

  test("a crash next to a failure is dropped and every item still runs", () => {
    const failure = new BootRuleViolation(RULE_A, "real");
    const seen: number[] = [];
    const error = thrownBy(() =>
      collectBootRuleViolations([1, 2, 3], (n) => {
        seen.push(n);
        if (n === 1) throw new TypeError("follow-up");
        if (n === 2) throw failure;
      }),
    );
    expect(error).toBe(failure);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("no failures and no crash does not throw", () => {
    expect(() => collectBootRuleViolations([1, 2], () => {})).not.toThrow();
  });
});
