// @runtime test
import {
  applyDefaultTheme,
  DEFAULT_THEMES,
  type DefaultThemeId,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

// Die 3 Doku-Themes. default-light/-dark sind der nackte renderer-web-Default
// (Mode via .dark-Klasse). brand demonstriert App-Mount-Customizing: ein
// Token-Override (Cream/Bernstein, recycelt aus marketing-demo) den der Runner
// zur Laufzeit injiziert — so braucht die App selbst keinen Theme-Code.

export const THEMES = [...DEFAULT_THEMES, "brand"] as const;
export type ThemeId = (typeof THEMES)[number];

const BRAND_VARS = `
  --color-background: #faf7f0;
  --color-foreground: #1a1814;
  --color-card: #ffffff;
  --color-card-foreground: #1a1814;
  --color-popover: #ffffff;
  --color-popover-foreground: #1a1814;
  --color-border: #e8e2d5;
  --color-input: #e8e2d5;
  --color-muted: #f5f2ea;
  --color-muted-foreground: #6b6259;
  --color-secondary: #f0ede5;
  --color-secondary-foreground: #1a1814;
  --color-accent: #f0ede5;
  --color-accent-foreground: #1a1814;
  --color-destructive: #dc2626;
  --color-destructive-foreground: #ffffff;
  --color-primary: #d97706;
  --color-primary-foreground: #ffffff;
  --color-ring: #d97706;
`;

const STYLE_ID = "sg-theme-override";

// Called AFTER the mount (the app reads localStorage at boot; we
// clear that via addInitScript, see spec). Deterministically sets the mode
// and injects the brand override with the same selector specificity as the
// renderer/web light block — as the last <style> it wins on a tie.
export async function applyTheme(page: Page, theme: ThemeId): Promise<void> {
  await applyDefaultTheme(page, (theme === "brand" ? "default-light" : theme) as DefaultThemeId);
  await page.evaluate(
    ({ theme, brandVars, styleId }) => {
      document.getElementById(styleId)?.remove();
      if (theme === "brand") {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `:root:not(.dark){${brandVars}}`;
        document.head.appendChild(style);
      }
    },
    { theme, brandVars: BRAND_VARS, styleId: STYLE_ID },
  );
}
