import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

export const MANAGED_PAGES_FEATURE = "managed-pages" as const;

export const BODY_FORMATS = ["markdown", "document"] as const;
export type BodyFormat = (typeof BODY_FORMATS)[number];

// Rows and events written before bodyFormat existed carry no value.
export const DEFAULT_BODY_FORMAT: BodyFormat = "markdown";

export function effectiveBodyFormat(value: unknown): BodyFormat {
  return isOneOf(BODY_FORMATS, value) ? value : DEFAULT_BODY_FORMAT;
}
