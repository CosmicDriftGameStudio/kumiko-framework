import { RUN_OUTCOME } from "../constants.ts";
import type { RunOutcome } from "../visible-results.ts";

export function toneOf(outcome: RunOutcome): "default" | "positive" | "negative" {
  if (outcome === RUN_OUTCOME.running) return "default";
  return outcome === RUN_OUTCOME.ok ? "positive" : "negative";
}
