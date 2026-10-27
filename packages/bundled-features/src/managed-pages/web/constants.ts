import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

// Pure data shared by the server (screen, handlers, render) and the client plugin.
export const PAGE_BODY_EXTENSION_NAME = "managed-pages:page-body";

export const BODY_FORMATS = ["markdown", "document"] as const;
export type BodyFormat = (typeof BODY_FORMATS)[number];

// Rows and events written before bodyFormat existed carry no value.
export const DEFAULT_BODY_FORMAT: BodyFormat = "markdown";

export function effectiveBodyFormat(value: unknown): BodyFormat {
  return isOneOf(BODY_FORMATS, value) ? value : DEFAULT_BODY_FORMAT;
}
