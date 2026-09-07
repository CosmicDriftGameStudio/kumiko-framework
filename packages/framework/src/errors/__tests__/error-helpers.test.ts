import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../classes";
import { AgentReasons as BarrelAgentReasons } from "../index";
import { AgentReasons, FrameworkReasons } from "../reasons";
import { buildInvalidTransitionDetails } from "../transition-details";
import { reraiseAsKumikoError, toWriteErrorInfo, writeFailure } from "../write-error-info";

describe("writeFailure", () => {
  test("wraps KumikoError into WriteFailure envelope", () => {
    const failure = writeFailure(new NotFoundError("invoice", "inv-1"));
    expect(failure.isSuccess).toBe(false);
    expect(failure.error.code).toBe("not_found");
    expect(failure.error.httpStatus).toBe(404);
  });
});

describe("reraiseAsKumikoError", () => {
  test("round-trips WriteErrorInfo through KumikoError", () => {
    const info = toWriteErrorInfo(new NotFoundError("task", 7));
    const err = reraiseAsKumikoError(info);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    expect(err.message).toContain("task");
  });
});

describe("buildInvalidTransitionDetails", () => {
  test("builds structured from/to/allowed + message", () => {
    const details = buildInvalidTransitionDetails("draft", "paid", ["sent"]);
    expect(details).toMatchObject({
      from: "draft",
      to: "paid",
      allowed: ["sent"],
    });
    expect(details.message).toContain("draft");
    expect(details.message).toContain("sent");
  });
});

describe("FrameworkReasons", () => {
  test("exposes stable snake_case reason codes", () => {
    expect(FrameworkReasons.invalidTransition).toBe("invalid_transition");
    expect(FrameworkReasons.staleState).toBe("stale_state");
  });
});

describe("AgentReasons", () => {
  test("exposes stable agent-prefixed reason codes", () => {
    expect(AgentReasons.toolNotAllowed).toBe("agent.tool_not_allowed");
    expect(AgentReasons.iterationLimit).toBe("agent.iteration_limit");
    expect(AgentReasons.permissionDenied).toBe("agent.permission_denied");
    expect(AgentReasons.highRiskNoAlways).toBe("agent.high_risk_no_always");
  });

  test("is importable from the errors barrel", () => {
    expect(BarrelAgentReasons).toBe(AgentReasons);
  });
});
