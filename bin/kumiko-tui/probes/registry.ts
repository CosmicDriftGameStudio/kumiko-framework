import type { Role } from "../types";
import type { StatusProbe } from "./types";

const REGISTRY: StatusProbe[] = [];

/** Register a probe. Called at module-import time by each probe-file. */
export function defineProbe(probe: StatusProbe): StatusProbe {
  REGISTRY.push(probe);
  return probe;
}

/** All probes that apply to the given role. Stable order = registration order. */
export function getProbes(role: Role): ReadonlyArray<StatusProbe> {
  return REGISTRY.filter((p) => p.roles.includes(role));
}
