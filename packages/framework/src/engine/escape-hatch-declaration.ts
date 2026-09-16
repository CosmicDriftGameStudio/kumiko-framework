import type { EscapeHatchDeclaration } from "@cosmicdrift/kumiko-types/handlers";

// Marks a standalone helper that escalates on a HandlerContext handed to it
// by its caller. The caller's registration carries the escapeHatch that
// authorizes it; this call makes the escalation visible at the site where it
// happens, where the guard and a reviewer both see it.
export function declareEscapeHatch(_declaration: EscapeHatchDeclaration): void {}
