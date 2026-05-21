// Side-effect imports — each probe-file registers itself in the
// registry on import. The status-screen calls `getProbes(role)` to
// receive the merged list.

import "./docker";
import "./git-state";
import "./stale-branches";
import "./test-dbs";

export { defineProbe, getProbes } from "./registry";
export type { ProbeLevel, ProbeReport, StatusProbe } from "./types";
