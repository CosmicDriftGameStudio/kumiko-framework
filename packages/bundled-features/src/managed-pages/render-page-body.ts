import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import { renderSafeMarkdown } from "../page-render/index.ts";
import { sanitizeDocumentHtml } from "../template-resolver/index.ts";
import type { BodyFormat } from "./constants.ts";

type WarnLogger = Pick<Logger, "warn">;

const defaultLog = createFallbackLogger("managed-pages");

export type RenderablePageBody = {
  readonly slug: string;
  readonly body: string;
  readonly bodyFormat: BodyFormat;
};

// A document body is re-sanitized at render time even though writes validate it:
// rows can predate the validation or arrive through other writers. A rejected
// document renders as an empty body (never the raw HTML) and is logged.
export function renderPageBody(page: RenderablePageBody, log: WarnLogger = defaultLog): string {
  if (page.bodyFormat === "markdown") return renderSafeMarkdown(page.body);
  const result = sanitizeDocumentHtml(page.body);
  if (result.ok) return result.html;
  log.warn("managed page document body rejected at render, serving an empty body", {
    slug: page.slug,
    violations: result.violations.map((violation) => violation.code),
  });
  return "";
}
