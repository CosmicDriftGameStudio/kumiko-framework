import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { isWriteFormEditSection } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "../headless/index.ts";
import { type StatusTone, statusToneForOptionTone, statusToneForValue } from "../primitives.tsx";
import { isAbsoluteHttpUrl } from "./projection-detail-navigation.ts";

export function headerStatusTone(
  header: NonNullable<ProjectionDetailScreenDefinition["header"]>,
  record: Readonly<Record<string, unknown>>,
): StatusTone | undefined {
  // skip: a header without status has no tone
  if (header.status === undefined) return undefined;
  const value = String(record[header.statusToneField ?? header.status] ?? "");
  const declared =
    header.statusTones !== undefined && Object.hasOwn(header.statusTones, value)
      ? header.statusTones[value]
      : undefined;
  const declaredTone = declared !== undefined ? statusToneForOptionTone(declared) : undefined;
  return declaredTone ?? statusToneForValue(value);
}

export function resolveSubtitleHref(
  header: ProjectionDetailScreenDefinition["header"],
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  // skip: no subtitleHref declared
  if (header?.subtitleHref === undefined) return undefined;
  const value = record[header.subtitleHref];
  return typeof value === "string" && isAbsoluteHttpUrl(value) ? value : undefined;
}

export type DetailTabItem = {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
};

export function buildDetailTabItems(
  sections: ProjectionDetailScreenDefinition["layout"]["sections"],
  record: Readonly<Record<string, unknown>>,
  translate: Translate,
): DetailTabItem[] {
  return sections.map((section) => {
    const countField = isWriteFormEditSection(section) ? undefined : section.countField;
    const countValue = countField !== undefined ? record[countField] : undefined;
    const count =
      typeof countValue === "number" && Number.isFinite(countValue) ? countValue : undefined;
    return {
      id: section.id ?? "",
      label: translate(section.title ?? section.id ?? ""),
      ...(count !== undefined && { count }),
    };
  });
}
