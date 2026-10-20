// Shared by the migrate-cross-tenant codemod (which writes it) and the escapeHatch reason
// validation (which rejects it), so an unedited codemod reason can never reach a running app.
export const CODEMOD_PLACEHOLDER_REASON_MARKER = "state the operator use case here";

export function codemodPlaceholderReasonProblem(reason: string): string | undefined {
  if (!reason.includes(CODEMOD_PLACEHOLDER_REASON_MARKER)) return undefined;
  return `the reason still contains the migrate-cross-tenant codemod placeholder ("${CODEMOD_PLACEHOLDER_REASON_MARKER}") — replace the codemod placeholder with the real operator use case`;
}

// Compared after trim, lowercase and stripping trailing punctuation.
const PLACEHOLDER_REASONS: ReadonlySet<string> = new Set([
  "todo",
  "tbd",
  "fixme",
  "legacy",
  "temp",
  "temporary",
  "hack",
  "wip",
  "n/a",
  "na",
  "none",
  "-",
  "?",
  "reason",
  "xxx",
]);

const PLACEHOLDER_REASON_PREFIXES = ["todo:", "fixme:", "tbd:"];

export function reasonProblem(reason: string): string | undefined {
  const lowered = reason.trim().toLowerCase();
  if (lowered.length === 0) return "the reason must be a non-empty explanation";
  const stripped = lowered.replace(/[.!:;,]+$/, "").trim();
  if (
    PLACEHOLDER_REASON_PREFIXES.some((prefix) => lowered.startsWith(prefix)) ||
    PLACEHOLDER_REASONS.has(stripped)
  ) {
    return `the reason "${reason.trim()}" is a placeholder — state why this access is needed`;
  }
  return codemodPlaceholderReasonProblem(reason);
}

export function assertReason(callerLabel: string, reason: string): void {
  const problem = reasonProblem(reason);
  if (problem !== undefined) throw new Error(`${callerLabel}: ${problem}`);
}
