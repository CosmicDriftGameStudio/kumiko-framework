import type { EscapeHatchDeclaration } from "@cosmicdrift/kumiko-types/handlers";
import { assertReason } from "./escape-hatch-reason.ts";

// Marks a standalone helper that escalates on a HandlerContext handed to it
// by its caller. The caller's registration carries the escapeHatch that
// authorizes it; this call makes the escalation visible at the site where it
// happens and rejects an empty or placeholder reason.
export function declareEscapeHatch(declaration: EscapeHatchDeclaration): void {
  assertReason("declareEscapeHatch", declaration.reason);
}
