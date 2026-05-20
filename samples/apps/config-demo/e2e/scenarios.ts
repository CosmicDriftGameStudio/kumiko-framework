import type { Page } from "@playwright/test";

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly flow?: (page: Page) => Promise<void>;
  readonly waitFor?: string;
  readonly settleMs?: number;
  readonly fullPage?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
}

async function writeConfig(
  page: Page,
  key: string,
  value: string | number | boolean,
  scope: "system" | "tenant" | "user",
): Promise<void> {
  // CSRF token is in cookie set by auto-mint JWT
  const csrf = await page.evaluate(() => {
    const m = document.cookie.match(/kumiko_csrf=([^;]+)/);
    return m?.[1] ?? "";
  });
  const res = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { type: "config:write:set", payload: { key, value, scope } },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`writeConfig ${key}=${value} (${scope}): ${res.status()} ${body}`);
  }
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "config-edit",
    description: "ConfigEdit-Formular im Ausgangszustand (nur Default-Badges)",
    url: "/settings",
    waitFor: "[data-testid='render-edit-form']",
    settleMs: 500,
  },
  {
    name: "config-edit-override",
    description: "ConfigEdit-Formular mit Tenant/User/Default-Badges (Überschreibungskaskade)",
    waitFor: "[data-testid='render-edit-form']",
    settleMs: 500,
    flow: async (page) => {
      // 1. Seite laden (Auto-Mint-JWT + CSRF-Cookies setzen)
      await page.goto("/settings");

      // 2. Auf Formular warten
      const form = page.locator('[data-testid="render-edit-form"]');
      await form.waitFor({ state: "visible", timeout: 10_000 });

      // 3. Tenant-Werte setzen → Tenant-Badge (grün)
      await writeConfig(page, "config-demo:config:site-name", "Config Demo", "tenant");
      await writeConfig(page, "config-demo:config:theme-color", "#6366f1", "tenant");
      await writeConfig(page, "config-demo:config:max-upload-size", 50, "tenant");

      //    User-Wert setzen → User-Badge (blau)
      await writeConfig(page, "config-demo:config:email-notifications", true, "user");

      //    autoApprove bleibt Default (kein Write) → Default-Badge (grau)

      // 4. Neu laden — jetzt mit verschiedenen Sources
      await page.goto("/settings");
    },
  },
];
