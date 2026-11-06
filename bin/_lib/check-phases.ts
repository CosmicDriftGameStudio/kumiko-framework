export const CHECK_PHASES = ["static", "tests"] as const;

export type CheckPhase = (typeof CHECK_PHASES)[number];

const PHASE_FLAG_PREFIX = "--phase=";

function isCheckPhase(value: string): value is CheckPhase {
  return (CHECK_PHASES as readonly string[]).includes(value);
}

/** `static` = Biome, TypeScript, guards and audits; `tests` = unit, DOM (and integration locally).
 *  Without `--phase` every phase runs, so a plain `kumiko check` is unchanged. */
export function parseCheckPhases(args: readonly string[]): ReadonlySet<CheckPhase> {
  const requested = args
    .filter((arg) => arg.startsWith(PHASE_FLAG_PREFIX))
    .map((arg) => arg.slice(PHASE_FLAG_PREFIX.length));
  if (requested.length === 0) return new Set(CHECK_PHASES);
  const unknown = requested.filter((value) => !isCheckPhase(value));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown check phase(s): ${unknown.join(", ")}. Valid: ${CHECK_PHASES.join(", ")}`,
    );
  }
  return new Set(requested.filter(isCheckPhase));
}
