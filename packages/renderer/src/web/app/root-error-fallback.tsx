import { ROOT_ERROR_FALLBACK_TEST_ID } from "@cosmicdrift/kumiko-types/error-boundary";
import type { ReactNode } from "react";

// Renders outside every provider, so no i18n/theme/primitives: plain DOM + inline text.
const ROOT_ERROR_TEXTS = {
  de: { title: "Etwas ist schiefgelaufen.", reload: "Seite neu laden" },
  en: { title: "Something went wrong.", reload: "Reload page" },
  es: { title: "Algo salió mal.", reload: "Recargar la página" },
} as const;

function rootErrorTexts(): (typeof ROOT_ERROR_TEXTS)[keyof typeof ROOT_ERROR_TEXTS] {
  const language = typeof navigator === "undefined" ? "en" : navigator.language;
  const lower = language.toLowerCase();
  if (lower.startsWith("de")) return ROOT_ERROR_TEXTS.de;
  if (lower.startsWith("es")) return ROOT_ERROR_TEXTS.es;
  return ROOT_ERROR_TEXTS.en;
}

export function RootErrorFallback(): ReactNode {
  const texts = rootErrorTexts();
  return (
    <div role="alert" data-testid={ROOT_ERROR_FALLBACK_TEST_ID}>
      <p>{texts.title}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {texts.reload}
      </button>
    </div>
  );
}
