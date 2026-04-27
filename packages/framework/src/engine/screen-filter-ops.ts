// Screen-Filter (Tier 2.7c) — Op-vs-Field-Type-Compatibility.
//
// Wer darf was filtern?
//   - text/select/multiSelect: nur equality-Ops (eq, ne, in). lt/gt
//     auf Strings ist semantisch fast immer Tippfehler (lexicographic
//     compare nutzt der Author selten bewusst); Author kann den
//     Filter dann einfach nicht setzen.
//   - boolean: eq, ne (in/lt/gt sinnlos für 2-Werte-Type).
//   - number/money/date/timestamp/locatedTimestamp: alle 5 Ops —
//     die Felder sind natürlich vergleichbar.
//
// Boot-Validator nutzt diese Map um Author-Fehler früh zu fangen
// ("filter mit op:lt auf einem text-Feld" → Boot-Fail). Erweitert sich
// transparent: neuer Field-Type → hier eintragen + sortable/filterable-
// Flag im Type-Def, sonst lehnt der Validator das Field generell ab.

import type { FieldDefinition, ScreenFilterOp } from "./types";

const EQUALITY_ONLY = ["eq", "ne", "in"] as const satisfies readonly ScreenFilterOp[];
const COMPARABLE = ["eq", "ne", "lt", "gt", "in"] as const satisfies readonly ScreenFilterOp[];
const BOOL_OPS = ["eq", "ne"] as const satisfies readonly ScreenFilterOp[];

export function getAllowedFilterOps(field: FieldDefinition): readonly ScreenFilterOp[] {
  switch (field.type) {
    case "text":
    case "select":
    case "multiSelect":
      return EQUALITY_ONLY;
    case "boolean":
      return BOOL_OPS;
    case "number":
    case "money":
    case "date":
    case "timestamp":
    case "locatedTimestamp":
      return COMPARABLE;
    // tz/embedded/file/image/files/images: nicht filterbar — Author
    // kann das Feld nicht als filterable: true markieren (Boot-
    // Validator weist `filterable: true` auf den Types ohnehin schon
    // ab, weil das Flag dort gar nicht im Type-Def steht).
    default:
      return [];
  }
}

// Author hat das Feld als filterable markiert? Tz/Embedded/File-Types
// haben das Flag gar nicht im Type-Def, also fangen wir das per
// `"filterable" in field`-Narrow ab.
export function isFieldFilterable(field: FieldDefinition): boolean {
  return "filterable" in field && field.filterable === true;
}
