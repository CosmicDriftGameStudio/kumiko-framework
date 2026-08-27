// Keeps document.documentElement.lang (+ dataset.kumikoLocale) in sync with
// the active locale. Screen readers and the browser's built-in translate
// offer read lang; dispatcher-live reads dataset.kumikoLocale for X-Locale
// (see dispatcher-live/src/locale.ts) so a static <html lang> cannot spoof
// the active UI language.
//
// Lives here, not in @cosmicdrift/kumiko-renderer: that package is DOM-free
// by design (Renderer-Boundaries Guard enforces it — web/native both
// consume it). createApp/createPublicSurface are the two places every web
// app already goes through, so mounting this here covers every app with
// zero app-side wiring, same as createBrowserLocaleResolver.

import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { useEffect } from "react";

function syncDocumentLocale(locale: string): void {
  document.documentElement.lang = locale;
  // Dedicated marker for dispatcher-live — static <html lang> must not
  // look like an active UI locale (kumiko-framework#2334).
  document.documentElement.dataset["kumikoLocale"] = locale;
}

export function DocumentLangSync({ resolver }: { readonly resolver: LocaleResolver }): null {
  useEffect(() => {
    syncDocumentLocale(resolver.locale());
    return resolver.subscribe(() => {
      syncDocumentLocale(resolver.locale());
    });
  }, [resolver]);
  return null;
}
