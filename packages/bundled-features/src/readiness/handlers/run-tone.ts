import type { RunOutcome } from "../visible-results.ts";

export function toneOf(outcome: RunOutcome): "default" | "positive" | "negative" {
  if (outcome === "running") return "default";
  return outcome === "ok" ? "positive" : "negative";
}
