import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import type { PatScopeConfig } from "../scopes";

// Returns the app-declared scopes ({name, label}) so the mint UI can render a
// checkbox per scope. Built from the config the feature was mounted with — the
// list is static per deployment, not per user.
export function buildAvailableScopesQuery(scopes: PatScopeConfig) {
  return defineQueryHandler({
    name: "api-token:available-scopes",
    schema: z.object({}),
    access: { openToAll: true },
    handler: async () =>
      Object.entries(scopes).map(([name, def]) => ({ name, label: def.label })),
  });
}
