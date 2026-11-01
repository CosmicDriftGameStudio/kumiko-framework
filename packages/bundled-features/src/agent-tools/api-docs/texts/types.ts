import type { patAuthRejectHttpStatus } from "@cosmicdrift/kumiko-framework/api";
import type { entityListSchema } from "@cosmicdrift/kumiko-framework/engine";
import type { FrameworkErrorCode } from "@cosmicdrift/kumiko-framework/errors";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

export type DocumentedErrorCode = FrameworkErrorCode | keyof typeof patAuthRejectHttpStatus;

export type ListParameterKey = keyof typeof entityListSchema.shape;

// Headings, column heads and short labels: the page structure, never overridable.
export const structureTextKeys = [
  "overview.title",
  "overview.endpoints.heading",
  "overview.auth.heading",
  "overview.body.heading",
  "overview.responses.heading",
  "overview.errors.heading",
  "overview.errors.columns",
  "overview.versions.heading",
  "overview.lists.heading",
  "overview.lists.columns",
  "overview.batch.heading",
  "overview.retry.heading",
  "tokens.title",
  "tokens.create.heading",
  "tokens.use.heading",
  "tokens.scopes.heading",
  "tokens.scopes.columns",
  "tokens.rateLimit.heading",
  "tokens.errors.heading",
  "tokens.errors.columns",
  "tokens.revoke.heading",
  "tokens.security.heading",
  "reference.requiredScope",
  "reference.endpoint",
  "reference.fields.columns",
  "reference.yes",
  "reference.no",
  "reference.exampleRequest",
  "reference.exampleResponse",
  "reference.status",
] as const;

// Running text: an app may replace single paragraphs through `apiDocs.texts`.
export const paragraphTextKeys = [
  "overview.description",
  "overview.intro",
  "overview.endpoints.query",
  "overview.endpoints.write",
  "overview.endpoints.batch",
  "overview.auth.body",
  "overview.body.body",
  "overview.responses.success",
  "overview.responses.error",
  "overview.versions.body",
  "overview.lists.intro",
  "overview.lists.response",
  "overview.batch.body",
  "overview.retry.body",
  "tokens.description",
  "tokens.intro",
  "tokens.create.step1",
  "tokens.create.step2",
  "tokens.create.step3",
  "tokens.create.step4",
  "tokens.expiry",
  "tokens.use.body",
  "tokens.scopes.intro",
  "tokens.rateLimit",
  "tokens.errors.missing",
  "tokens.errors.invalid",
  "tokens.errors.scope",
  "tokens.errors.route",
  "tokens.errors.rate",
  "tokens.errors.disabled",
  "tokens.revoke.body",
  "tokens.security.item1",
  "tokens.security.item2",
  "tokens.security.item3",
  "reference.description",
  "reference.noFields",
  "reference.excluded",
] as const;

export type StructureTextKey = (typeof structureTextKeys)[number];
export type ParagraphTextKey = (typeof paragraphTextKeys)[number];
export type ApiDocsTextKey = StructureTextKey | ParagraphTextKey;

export type ApiDocsTexts = {
  readonly text: Readonly<Record<ApiDocsTextKey, string>>;
  readonly errorMeanings: Readonly<Record<DocumentedErrorCode, string>>;
  readonly listParameters: Readonly<Record<ListParameterKey, string>>;
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function placeholdersOf(template: string): ReadonlySet<string> {
  return new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""));
}

export function formatApiDocsText(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`API docs text is missing the parameter "${name}": ${template}`);
    }
    return String(value);
  });
}

export function isParagraphTextKey(key: string): key is ParagraphTextKey {
  return isOneOf(paragraphTextKeys, key);
}
