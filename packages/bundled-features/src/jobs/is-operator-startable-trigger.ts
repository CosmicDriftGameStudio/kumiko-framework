import type { JobDefinition } from "@cosmicdrift/kumiko-framework/engine";

// Maintenance jobs only touch rows already past their own retention cutoff, so an early run is safe.
export function isOperatorStartableTrigger(trigger: JobDefinition["trigger"]): boolean {
  if ("manual" in trigger) return trigger.manual === true;
  return "maintenance" in trigger && trigger.maintenance === true;
}
