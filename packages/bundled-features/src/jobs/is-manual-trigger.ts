import type { JobDefinition } from "@cosmicdrift/kumiko-framework/engine";

export function isManualTrigger(trigger: JobDefinition["trigger"]): boolean {
  return "manual" in trigger && trigger.manual === true;
}
