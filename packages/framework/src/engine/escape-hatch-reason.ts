// Shared by the migrate-cross-tenant codemod (which writes it) and the escapeHatch reason
// validation (which rejects it), so an unedited codemod reason can never reach a running app.
export const CODEMOD_PLACEHOLDER_REASON_MARKER = "state the operator use case here";

export function codemodPlaceholderReasonProblem(reason: string): string | undefined {
  if (!reason.includes(CODEMOD_PLACEHOLDER_REASON_MARKER)) return undefined;
  return `the reason still contains the migrate-cross-tenant codemod placeholder ("${CODEMOD_PLACEHOLDER_REASON_MARKER}") — replace the codemod placeholder with the real operator use case`;
}
