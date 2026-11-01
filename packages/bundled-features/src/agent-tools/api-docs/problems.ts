import type { AgentDocGap } from "../agent-doc-lint.ts";
import { formatAgentDocGap } from "../agent-doc-lint.ts";

export type ApiDocsProblem =
  | { readonly kind: "patFeatureMissing" }
  | { readonly kind: "docGap"; readonly gap: AgentDocGap }
  | {
      readonly kind: "descriptionTranslationMissing";
      readonly qn: string;
      readonly locale: string;
    }
  | {
      readonly kind: "uiWriteOutsideScopes";
      readonly qn: string;
      readonly screens: readonly string[];
    }
  | { readonly kind: "unusedUiOnlyWrite"; readonly pattern: string }
  | {
      readonly kind: "invalidTextOverride";
      readonly locale: string;
      readonly key: string;
      readonly cause: string;
    };

export function formatApiDocsProblem(problem: ApiDocsProblem): string {
  switch (problem.kind) {
    case "patFeatureMissing":
      return "[patFeatureMissing] The app mounts no personal-access-tokens feature with scopes, so there is nothing to document.";
    case "docGap":
      return `[docGap] ${formatAgentDocGap(problem.gap)}`;
    case "descriptionTranslationMissing":
      return `[descriptionTranslationMissing] ${problem.qn} has no \`${problem.locale}\` description translation.`;
    case "uiWriteOutsideScopes":
      return `[uiWriteOutsideScopes] ${problem.qn} is used by ${problem.screens.join(", ")} but no token scope grants it. Add it to a scope or list it under apiDocs.uiOnlyWrites.`;
    case "unusedUiOnlyWrite":
      return `[unusedUiOnlyWrite] apiDocs.uiOnlyWrites pattern "${problem.pattern}" matches no UI write outside the scopes.`;
    case "invalidTextOverride":
      return `[invalidTextOverride] apiDocs.texts.${problem.locale}["${problem.key}"]: ${problem.cause}`;
  }
}

export function sortApiDocsProblems(problems: readonly ApiDocsProblem[]): ApiDocsProblem[] {
  const keyed = problems.map((problem) => ({ problem, key: formatApiDocsProblem(problem) }));
  return keyed
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ problem }) => problem);
}
