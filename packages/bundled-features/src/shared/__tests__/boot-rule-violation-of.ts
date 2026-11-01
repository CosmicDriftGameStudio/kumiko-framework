import { BootRuleViolation } from "@cosmicdrift/kumiko-framework/engine";

export function bootRuleViolationOf(trigger: () => unknown): BootRuleViolation {
  try {
    trigger();
  } catch (error) {
    if (error instanceof BootRuleViolation) return error;
    throw error;
  }
  throw new Error("expected the trigger to throw a BootRuleViolation");
}
