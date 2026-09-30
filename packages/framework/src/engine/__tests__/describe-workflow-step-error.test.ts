import { describe, expect, test } from "bun:test";
import { describeWorkflowStepError } from "../steps/describe-workflow-step-error";

describe("describeWorkflowStepError", () => {
  test("uses the error class name and never the message", () => {
    const text = describeWorkflowStepError(new TypeError("send to jane.doe@example.com failed"));
    expect(text).toBe("workflow step failed (TypeError)");
    expect(text).not.toContain("jane.doe@example.com");
  });

  test("non-Error throwables are described as unknown and not stringified", () => {
    expect(describeWorkflowStepError("jane.doe@example.com")).toBe(
      "workflow step failed (unknown error)",
    );
    expect(describeWorkflowStepError(undefined)).toBe("workflow step failed (unknown error)");
  });
});
