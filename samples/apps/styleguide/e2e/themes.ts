import type { Page } from "@playwright/test";

// Die 3 Doku-Themes. default-light/-dark sind der nackte renderer-web-Default
// (Mode via .dark-Klasse). brand demonstriert App-Mount-Customizing: ein
// Token-Override (Cream/Bernstein, recycelt aus marketing-demo) den der Runner
// zur Laufzeit injiziert — so braucht die App selbst keinen Theme-Code.

export const THEMES = ["default-light", "default-dark", "brand"] as const;
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

// Wird NACH dem Mount aufgerufen (die App liest beim Boot localStorage; das
// löschen wir per addInitScript, siehe spec). Setzt deterministisch den Mode
// und injiziert das Brand-Override mit gleicher Selektor-Spezifität wie der
// renderer-web Light-Block — als letztes <style> gewinnt es bei Gleichstand.
export async function applyTheme(page: Page, theme: ThemeId): Promise<void> {
  await page.evaluate(
    ({ theme, brandVars, styleId }) => {
      document.documentElement.classList.toggle("dark", theme === "default-dark");
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
