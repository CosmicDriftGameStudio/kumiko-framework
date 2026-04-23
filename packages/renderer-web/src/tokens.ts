import type { Tokens } from "@kumiko/renderer";

// Default-Tokens für den Web-Renderer. Dark-Theme ist der historische
// Default des Samples; Apps mit Light-Theme-Anforderung überschreiben
// über createKumikoApp({ tokens: {...} }). Zweite Preset-Konstante
// `lightTokens` damit ein Dark/Light-Toggle im App-Code kein
// Handzumix aus Hex-Strings braucht.

export const defaultTokens: Tokens = {
  color: {
    background: "#0b0d10",
    surface: "#111418",
    text: "#e5e7eb",
    textMuted: "#9ca3af",
    border: "#1f2937",
    primary: { background: "#2563eb", text: "#ffffff" },
    danger: { background: "#dc2626", text: "#ffffff" },
    success: { background: "#16a34a", text: "#ffffff" },
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "20px",
    xl: "28px",
  },
  radius: {
    sm: "3px",
    md: "6px",
  },
  fontSize: {
    body: "13px",
    small: "11px",
    heading: "15px",
  },
};

/** Light-Theme als Komplementär-Preset. Gleiche Struktur wie
 *  `defaultTokens`, nur mit hellen Farben. Apps nutzen das als
 *  Startpunkt für einen Theme-Toggle. */
export const lightTokens: Tokens = {
  ...defaultTokens,
  color: {
    background: "#ffffff",
    surface: "#f3f4f6",
    text: "#111827",
    textMuted: "#6b7280",
    border: "#d1d5db",
    primary: { background: "#2563eb", text: "#ffffff" },
    danger: { background: "#dc2626", text: "#ffffff" },
    success: { background: "#16a34a", text: "#ffffff" },
  },
};

/** Spiegelt Tokens rekursiv auf :root CSS-Variables. Jeder String-
 *  Leaf wird zu einer Variable mit kebab-case-Pfad: `color.primary.
 *  background` → `--kumiko-color-primary-background`. Funktioniert
 *  automatisch auch für AppTokens-Erweiterungen (chart, brand, etc.).
 *
 *  Wird beim Bootstrap UND bei jedem setTokens-Aufruf ausgeführt —
 *  der Browser animiert CSS-transitions wenn die App welche auf den
 *  betroffenen Eigenschaften gesetzt hat. */
export function applyTokensToCssVars(tokens: Tokens): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  writeVars(root, "--kumiko", tokens as unknown as Record<string, unknown>);
  // Grundstil auf body — Browser-Defaults (weißes Papier-Background,
  // serif Font) sind für eine App-Shell verkehrt. Apps die ihr
  // eigenes Body-Styling mitbringen (Tailwind preflight, normalize.css)
  // überschreiben das einfach mit spezifischeren Regeln.
  document.body.style.background = tokens.color.background;
  document.body.style.color = tokens.color.text;
  document.body.style.fontSize = tokens.fontSize.body;
  document.body.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  document.body.style.margin = "0";
}

function writeVars(root: HTMLElement, prefix: string, node: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(node)) {
    const varName = `${prefix}-${kebab(key)}`;
    if (typeof value === "string") {
      root.style.setProperty(varName, value);
    } else if (isPlainObject(value)) {
      writeVars(root, varName, value);
    }
    // Andere Typen (number, boolean, null) werden ignoriert — Kumikos
    // Tokens sind per Contract strings.
  }
}

function kebab(s: string): string {
  // camelCase → kebab-case. Keine regex-Magie, nur simple Ersetzung
  // auf Uppercase-Grenzen: "textMuted" → "text-muted",
  // "primaryBackground" → "primary-background".
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
