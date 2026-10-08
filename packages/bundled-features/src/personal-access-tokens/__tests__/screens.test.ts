import { describe, expect, test } from "bun:test";
import { MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_FEATURE_I18N, patScopeOptionTranslations } from "../i18n.js";
import type { PatScopeConfig } from "../scopes.js";
import { patListScreen } from "../screens.js";

const PAT_STATUSES = ["active", "revoked", "expired"] as const;

describe("PAT list status column", () => {
  test("renders the computed status through enumOption with a translation per status", () => {
    const statusColumn = patListScreen.columns.find(
      (column) => typeof column !== "string" && column.field === "status",
    );
    if (statusColumn === undefined || typeof statusColumn === "string") {
      throw new Error("status column missing");
    }
    const renderer = statusColumn.renderer;
    if (
      typeof renderer !== "object" ||
      !("format" in renderer) ||
      renderer.format !== "enumOption"
    ) {
      throw new Error("status column must use the enumOption format");
    }
    for (const status of PAT_STATUSES) {
      expect(PAT_FEATURE_I18N[`${renderer.keyPrefix}${status}`]?.en).toBeTruthy();
    }
  });
});

describe("PAT list pagination contract", () => {
  // `mine` accepts only `limit` (no offset/totalCount), so a pager would
  // re-serve page 1 and hide older tokens from revocation.
  test("fetches one max-size page and renders no pager", () => {
    expect(patListScreen.pagination).toBe(false);
    expect(patListScreen.pageSize).toBe(MAX_LIST_LIMIT);
  });
});

describe("PAT list scopes column and sorting", () => {
  const scopesColumn = patListScreen.columns.find(
    (column) => typeof column !== "string" && column.field === "scopes",
  );

  test("scopes render through the same option keys as the mint form's scopes options", () => {
    const scopeConfig: PatScopeConfig = {
      ledger: { label: "Billing", read: ["ledger:read"], write: ["ledger:write"] },
    };
    const translations = patScopeOptionTranslations(scopeConfig);
    if (scopesColumn === undefined || typeof scopesColumn === "string") {
      throw new Error("scopes column missing");
    }
    const renderer = scopesColumn.renderer;
    if (
      typeof renderer !== "object" ||
      !("format" in renderer) ||
      renderer.format !== "enumOption"
    ) {
      throw new Error("scopes column must use the enumOption format");
    }
    expect(translations[`${renderer.keyPrefix}ledger:write`]?.en).toBe("Billing (read & write)");
  });

  test("only columns the `mine` query can order by stay sortable", () => {
    const unsortable = patListScreen.columns
      .filter((column) => typeof column !== "string" && column.sortable === false)
      .map((column) => (typeof column === "string" ? column : column.field));
    expect(unsortable.sort()).toEqual(["prefix", "scopes", "status"]);
  });
});
