// runIn lane-routing helpers. Tiny module on purpose: both buildServer
// (MSP-consumer filter) and the boot-validator (Welle 2.6.c coverage
// check) need the same resolution rule, and duplicating it in two places
// invites drift — when the default changes, one site gets updated and
// the other silently doesn't.
//
// Resolution rule:
//   - `runIn: undefined` resolves to "worker" — that's the prod default
//     for async work (API instances stay request-focused, heavy async
//     work lives on the worker fleet).
//   - `runIn: "both"` means "eligible on any lane" — SKIP LOCKED on the
//     consumer cursor handles the race between processes that want the
//     same event. Used for cross-lane load-balancing and for MSPs that
//     have no reason to pin to a specific process shape.
//   - `runIn: "api"` / `runIn: "worker"` pin to one lane.
//
// processLane describes the CURRENT process's role:
//   - "api" / "worker" — single-role deploy, filter strictly.
//   - "both"           — all-in-one, no filtering (one process does it all).

import type { RunIn } from "./types";

// Does a consumer with `runIn` want to run on a process of the given lane?
export function runsInLane(runIn: RunIn | undefined, processLane: RunIn): boolean {
  if (processLane === "both") return true;
  const resolved = runIn ?? "worker";
  if (resolved === "both") return true;
  return resolved === processLane;
}
