import { patScopeOptionKey } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// The scope domains in run-config.ts are the app's choice, so their German
// labels are too: personal-access-tokens only generates the English ones.
export const patScopeLabelsFeature = defineFeature("pat-scope-labels", (r) => {
  r.describe("German labels for the token scopes this sample app declares.");
  r.translations({
    keys: {
      [patScopeOptionKey("pages", "read")]: { de: "Seiten (lesen)" },
      [patScopeOptionKey("pages", "write")]: { de: "Seiten (lesen & schreiben)" },
      [patScopeOptionKey("tags", "read")]: { de: "Tags (lesen)" },
      [patScopeOptionKey("tags", "write")]: { de: "Tags (lesen & schreiben)" },
      [patScopeOptionKey("notesHistory", "read")]: { de: "Notizen (lesen)" },
      [patScopeOptionKey("notesHistory", "write")]: { de: "Notizen (lesen & schreiben)" },
      [patScopeOptionKey("ledger", "read")]: { de: "Hauptbuch (lesen)" },
      [patScopeOptionKey("ledger", "write")]: { de: "Hauptbuch (lesen & schreiben)" },
    },
  });
  return {};
});
