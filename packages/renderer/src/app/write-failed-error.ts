import type { DispatcherError } from "@cosmicdrift/kumiko-headless";

// dispatcher.write wirft bei Server-Fehlern NICHT — es returnt
// { isSuccess: false, error }. Action-Wiring das das Result verwirft,
// macht Fehler unsichtbar ("Klick tut nichts"-Prod-Bug 2026-06-07).
// Diese Klasse trägt den strukturierten DispatcherError dahin, wo eine
// UI ihn anzeigen kann (Toast mit docsUrl).
export class WriteFailedError extends Error {
  readonly dispatcherError: DispatcherError;

  constructor(error: DispatcherError, message: string) {
    super(message);
    this.name = "WriteFailedError";
    this.dispatcherError = error;
  }
}

// i18nKey gewinnt wenn das Bundle ihn kennt (translate returnt den Key
// unverändert wenn nicht — Renderer-Convention), sonst message, zuletzt code.
export function dispatcherErrorText(
  error: DispatcherError,
  translate: (key: string) => string,
): string {
  const translated = translate(error.i18nKey);
  if (translated !== error.i18nKey) return translated;
  return error.message !== "" ? error.message : error.code;
}
