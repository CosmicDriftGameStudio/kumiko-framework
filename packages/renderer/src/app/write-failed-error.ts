import type { DispatcherError } from "../headless/index.ts";

// dispatcher.write does NOT throw on server errors; it returns
// { isSuccess: false, error }. Action wiring that discards the result
// makes failures invisible ("click does nothing" in production).
// This class carries the structured DispatcherError to a layer that can
// display it in the UI, such as a toast with docsUrl.
export class WriteFailedError extends Error {
  readonly dispatcherError: DispatcherError;

  constructor(error: DispatcherError, message: string) {
    super(message);
    this.name = "WriteFailedError";
    this.dispatcherError = error;
  }
}

// i18nKey takes precedence when the bundle knows it (translate returns
// the key unchanged when it does not, per the renderer convention),
// followed by message and then code.
export function dispatcherErrorText(
  error: DispatcherError,
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
): string {
  const translated = translate(error.i18nKey, error.i18nParams);
  if (translated !== error.i18nKey) return translated;
  return error.message !== "" ? error.message : error.code;
}
