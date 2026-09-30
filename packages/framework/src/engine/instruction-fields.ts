import type { EntityDefinition } from "./types/index.js";

// Shared between the executor gate (payload-presence check on create/update)
// and the define-time floor (resolveEntityWriteAgentHints) so both read the
// exact same field set — a divergence here would let one enforce a flag the
// other doesn't know about.
export function instructionFieldNames(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => "readAsInstruction" in field && field.readAsInstruction === true)
    .map(([name]) => name);
}
