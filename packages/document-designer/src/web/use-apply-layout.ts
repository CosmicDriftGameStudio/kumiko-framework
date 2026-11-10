import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { type UseMutationResult, useMutation } from "@cosmicdrift/kumiko-renderer";
import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";

export type TemplateRef = { readonly slug: string; readonly locale: string };
export type TemplateOutcome = TemplateRef & { readonly reason: string };

export function templateOutcomeText(t: Translate, item: TemplateOutcome): string {
  const key = `templateResolver.errors.${item.reason}`;
  const translated = t(key);
  return `${item.slug} (${item.locale}): ${translated === key ? item.reason : translated}`;
}

export type ApplyLayoutTarget =
  | { readonly mode: "all" }
  | { readonly mode: "selected"; readonly templates: readonly TemplateRef[] };

export type ApplyLayoutResponse = {
  readonly applied: readonly TemplateRef[];
  readonly skipped: readonly TemplateOutcome[];
};

export type PublishTemplatesResponse = {
  readonly published: readonly TemplateRef[];
  readonly failed: readonly TemplateOutcome[];
};

export function useApplyLayout(): {
  readonly apply: UseMutationResult<ApplyLayoutResponse>;
  readonly publish: UseMutationResult<PublishTemplatesResponse>;
} {
  return {
    apply: useMutation<ApplyLayoutResponse>(TemplateResolverHandlers.applyLayout),
    publish: useMutation<PublishTemplatesResponse>(TemplateResolverHandlers.publishTemplates),
  };
}
