import { describe, expect, test } from "bun:test";
import { PAT_FEATURE_I18N } from "../i18n.js";
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
