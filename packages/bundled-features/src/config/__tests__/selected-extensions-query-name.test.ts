import { describe, expect, test } from "bun:test";
import { createRegistry, SELECTED_EXTENSIONS_QUERY } from "@cosmicdrift/kumiko-framework/engine";
import { ConfigQueries } from "../constants.js";
import { createConfigFeature } from "../feature.js";

// The framework's generated settings dashboard points visibleWhen at this QN but
// cannot import bundled-features; if the handler is renamed the panels would
// silently never show.
describe("selected-extensions query-name pin", () => {
  test("framework's SELECTED_EXTENSIONS_QUERY equals the config feature's constant", () => {
    expect(SELECTED_EXTENSIONS_QUERY).toBe(ConfigQueries.selectedExtensions);
  });

  test("the QN is a query handler registered by the config feature", () => {
    const registry = createRegistry([createConfigFeature()]);
    expect(registry.getAllQueryHandlers().has(SELECTED_EXTENSIONS_QUERY)).toBe(true);
  });
});
