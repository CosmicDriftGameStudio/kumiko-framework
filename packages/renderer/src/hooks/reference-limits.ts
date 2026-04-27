// Tier 2.7e Audit-Fix #7: Reference-Lookup-Limits zentral.
//
// Zwei verschiedene Use-Cases mit unterschiedlichen Default-Limits:
//   - Combobox-Edit (single User picks one): 50 reicht weil
//     typed-search-Fallback aktiv ist (REMOTE_SEARCH_DEBOUNCE_MS).
//   - List-Bulk-Display (Cell-Render für viele Rows): 200 weil wir
//     pro Reference-Spalte einmal pro Page laden, nicht pro Cell.
//
// Apps können die Defaults überschreiben indem sie die Konstanten
// hier neu setzen — pro feature/app gibt's heute keine Override-API
// (das wäre eine Erweiterung in createKumikoApp, separater Sprint).
// Die Konstanten leben in einem eigenen Modul damit Future-Author
// sie an einer Stelle findet statt verstreut zwischen render-field
// und use-reference-lookup.

export const REFERENCE_COMBOBOX_LIMIT = 50;
export const REFERENCE_LIST_LOOKUP_LIMIT = 200;
export const REFERENCE_SEARCH_DEBOUNCE_MS = 300;
