import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import type { PatScopeConfig } from "../scopes";

// Returns the app-declared scope domains ({name, label, canWrite}) so the mint
// UI can render a per-domain level picker (no access / read / read & write).
// canWrite is false for read-only domains → the UI hides the write option.
// Static per deployment, not per user.
export function buildAvailableScopesQuery(scopes: PatScopeConfig) {
  return defineQueryHandler({
    name: "available-scopes",
    schema: z.object({}),
    access: { openToAll: true },
    handler: async () =>
      Object.entries(scopes).map(([name, def]) => ({
        name,
        label: def.label,
        canWrite: (def.write?.length ?? 0) > 0,
      })),
  });
}
