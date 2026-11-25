import type { DispatcherError } from "../headless/index.ts";

const UNPROCESSABLE_CODE = "unprocessable";
const GENERIC_UNPROCESSABLE_I18N_KEY = "errors.unprocessable";

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

// failUnprocessable(reason) carries the slug in details.reason under the generic i18nKey;
// r.translations keys reach the client unprefixed, so the slug is a lookup key itself.
export function unprocessableReasonText(
  error: DispatcherError,
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
): string | undefined {
  if (error.code !== UNPROCESSABLE_CODE || error.i18nKey !== GENERIC_UNPROCESSABLE_I18N_KEY) {
    return undefined;
  }
  const reason = error.details?.["reason"];
  if (typeof reason === "string") {
    const text = translate(reason, error.i18nParams);
    if (text !== reason) return text;
  }
  const detailMessage = error.details?.["message"];
  return typeof detailMessage === "string" && detailMessage !== "" ? detailMessage : undefined;
}

// i18nKey takes precedence when the bundle knows it (translate returns
// the key unchanged when it does not, per the renderer convention),
// followed by message and then code. A known details.reason of a generic unprocessable error comes first.
export function dispatcherErrorText(
  error: DispatcherError,
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
): string {
  const reasonText = unprocessableReasonText(error, translate);
  if (reasonText !== undefined) return reasonText;
  const translated = translate(error.i18nKey, error.i18nParams);
  if (translated !== error.i18nKey) return translated;
  return error.message !== "" ? error.message : error.code;
}

// A validation_error alone says nothing; the server names the offending field and reason per
// issue, so the user gets those as text.
export function dispatcherErrorTextWithFieldIssues(
  error: DispatcherError,
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
): string {
  const headline = dispatcherErrorText(error, translate);
  const issues = (error.details?.fields ?? []).map((issue) => {
    const text = translate(issue.i18nKey, issue.params);
    return text === issue.i18nKey ? `${issue.path}: ${issue.code}` : text;
  });
  return issues.length === 0 ? headline : `${headline} ${issues.join(" ")}`;
}
