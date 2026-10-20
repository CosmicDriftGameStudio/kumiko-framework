import { ROOT_ERROR_FALLBACK_TEST_ID } from "@cosmicdrift/kumiko-types/error-boundary";
import { type CSSProperties, type ReactNode, useState } from "react";

// Renders outside every provider and possibly without loaded CSS, so no i18n/theme/primitives: plain DOM, inline text and inline styles.
const ROOT_ERROR_TEXTS = {
  de: {
    title: "Etwas ist schiefgelaufen.",
    reload: "Seite neu laden",
    reference: "Fehler-ID",
    copy: "Kopieren",
    copied: "Kopiert!",
  },
  en: {
    title: "Something went wrong.",
    reload: "Reload page",
    reference: "Error ID",
    copy: "Copy",
    copied: "Copied!",
  },
  es: {
    title: "Algo salió mal.",
    reload: "Recargar la página",
    reference: "ID de error",
    copy: "Copiar",
    copied: "¡Copiado!",
  },
} as const;

function rootErrorTexts(): (typeof ROOT_ERROR_TEXTS)[keyof typeof ROOT_ERROR_TEXTS] {
  const language = typeof navigator === "undefined" ? "en" : navigator.language;
  const lower = language.toLowerCase();
  if (lower.startsWith("de")) return ROOT_ERROR_TEXTS.de;
  if (lower.startsWith("es")) return ROOT_ERROR_TEXTS.es;
  return ROOT_ERROR_TEXTS.en;
}

const containerStyle: CSSProperties = {
  boxSizing: "border-box",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "16px",
  padding: "24px",
  textAlign: "center",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  color: "#1a1a1a",
  background: "#ffffff",
};

const titleStyle: CSSProperties = { margin: 0, fontSize: "20px", fontWeight: 600 };
const referenceStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: "8px",
  fontSize: "13px",
  color: "#555555",
};
const codeStyle: CSSProperties = {
  fontFamily: "ui-monospace, Menlo, monospace",
  wordBreak: "break-all",
};
const buttonStyle: CSSProperties = {
  padding: "8px 16px",
  fontSize: "14px",
  borderRadius: "6px",
  border: "1px solid #888888",
  background: "#f4f4f5",
  color: "#1a1a1a",
  cursor: "pointer",
};

export function RootErrorFallback({ errorId }: { readonly errorId?: string }): ReactNode {
  const texts = rootErrorTexts();
  const [copied, setCopied] = useState(false);

  async function copyErrorId(): Promise<void> {
    if (errorId === undefined) return;
    try {
      await navigator.clipboard.writeText(errorId);
      setCopied(true);
    } catch {
      // Clipboard denied or unavailable: the id stays visible and selectable.
    }
  }

  return (
    <div role="alert" data-testid={ROOT_ERROR_FALLBACK_TEST_ID} style={containerStyle}>
      <p style={titleStyle}>{texts.title}</p>
      {errorId !== undefined && (
        <div style={referenceStyle} data-testid={`${ROOT_ERROR_FALLBACK_TEST_ID}-reference`}>
          <span>
            {texts.reference}: <span style={codeStyle}>{errorId}</span>
          </span>
          <button
            type="button"
            style={buttonStyle}
            data-testid={`${ROOT_ERROR_FALLBACK_TEST_ID}-copy`}
            onClick={() => void copyErrorId()}
          >
            {copied ? texts.copied : texts.copy}
          </button>
        </div>
      )}
      <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
        {texts.reload}
      </button>
    </div>
  );
}
