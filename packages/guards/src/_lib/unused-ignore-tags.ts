import type { SourceFile } from "ts-morph";
import { commentLines } from "./comment-lines";
import type { GuardViolation } from "./guard-kit";
import { ignoreTagSlug, isIgnoreTagUsed, KUMIKO_IGNORE_TAG_RE } from "./ignore-tag";

export const UNUSED_IGNORE_TAGS_CHECK = "unused-ignore-tags";

export type CheckedIgnoreTag = { readonly tag: string; readonly files: readonly SourceFile[] };

function isPlaceholder(text: string): boolean {
  return text.startsWith("<");
}

export function unusedIgnoreTagViolations(checked: readonly CheckedIgnoreTag[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const { tag, files } of checked) {
    const slug = ignoreTagSlug(tag);
    for (const sf of files) {
      for (const { line, body } of commentLines(sf.getFullText())) {
        const match = KUMIKO_IGNORE_TAG_RE.exec(body);
        if (match === null) continue;
        const slugList = match[1] ?? "";
        const reason = (match[2] ?? "").trim();
        if (isPlaceholder(slugList) || isPlaceholder(reason)) continue;
        if (!slugList.split(",").includes(slug)) continue;
        if (isIgnoreTagUsed(sf.getFilePath(), line, slug)) continue;
        violations.push({
          file: sf.getFilePath(),
          line,
          message: `"kumiko-lint-ignore ${slug}" suppresses nothing here: its guard reports no finding at this spot. Delete the marker.`,
        });
      }
    }
  }
  return violations;
}
