import { dispatcherErrorText } from "@cosmicdrift/kumiko-renderer";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// A validation_error alone says nothing; the server names the offending field
// and reason per issue, so the user gets those as text.
export function errorTextWithFieldIssues(error: DispatcherError, translate: Translate): string {
  const headline = dispatcherErrorText(error, translate);
  const issues = (error.details?.fields ?? []).map((issue) => {
    const text = translate(issue.i18nKey, issue.params);
    return text === issue.i18nKey ? `${issue.path}: ${issue.code}` : text;
  });
  return issues.length === 0 ? headline : `${headline} ${issues.join(" ")}`;
}
