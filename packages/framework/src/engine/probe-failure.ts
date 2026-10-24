import type { ProbeText } from "@cosmicdrift/kumiko-types/probe";

// Thrown by a probe to report a translatable failure; any other error maps to a generic text so raw messages never reach the run.
export class ProbeFailure extends Error {
  constructor(readonly text: ProbeText) {
    super(text.key);
    this.name = "ProbeFailure";
  }
}
