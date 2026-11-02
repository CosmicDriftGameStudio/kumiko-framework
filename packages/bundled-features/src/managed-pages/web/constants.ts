import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

// Pure data shared by the server (screen, handlers, render) and the client plugin.

export const PAGE_CREATE_HANDLER = "managed-pages:write:page:create";
export const PAGE_UPDATE_HANDLER = "managed-pages:write:page:update";
export const PAGE_DETAIL_QUERY = "managed-pages:query:page:detail";

// Same id for the list's `navigate` row action, the apps' navs and the custom screen component.
export const PAGE_EDIT_SCREEN_ID = "page-edit";
export const PAGE_LIST_SCREEN_ID = "page-list";

export const BODY_FORMATS = ["markdown", "document"] as const;
export type BodyFormat = (typeof BODY_FORMATS)[number];

// Rows and events written before bodyFormat existed carry no value.
export const DEFAULT_BODY_FORMAT: BodyFormat = "markdown";

export function effectiveBodyFormat(value: unknown): BodyFormat {
  return isOneOf(BODY_FORMATS, value) ? value : DEFAULT_BODY_FORMAT;
}
