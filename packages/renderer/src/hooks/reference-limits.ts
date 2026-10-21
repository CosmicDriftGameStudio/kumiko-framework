// Reference lookup limits are centralized here.
//
// Two use cases have different default limits:
//   - Combobox editing (a user picks one): 50 is sufficient because the
//     typed-search fallback is active (REMOTE_SEARCH_DEBOUNCE_MS).
//   - Bulk list display (rendering cells for many rows): 200 because each
//     reference column is loaded once per page, not once per cell.
//
// Apps can override the defaults by changing these constants, but there is
// currently no per-feature or per-app override API; adding one would require
// extending createKumikoApp.
// The constants live in their own module so future authors can find them in
// one place instead of searching through render-field and use-reference-lookup.

export const REFERENCE_COMBOBOX_LIMIT = 50;
export const REFERENCE_LIST_LOOKUP_LIMIT = 200;
export const REFERENCE_SEARCH_DEBOUNCE_MS = 300;
