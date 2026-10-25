import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  isFieldsEditSection,
  isFormatSpec,
  isWriteFormEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FormatSpec } from "@cosmicdrift/kumiko-types/screen";
import { applyFormatSpec, type Translate } from "../headless/index.ts";
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

function layoutStatusFormat(
  screen: ProjectionDetailScreenDefinition,
  statusField: string,
): FormatSpec | undefined {
  for (const section of screen.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section)) {
      const field = normalizeEditField(spec);
      if (field.field !== statusField) continue;
      const renderer = field.renderer;
      if (
        isFormatSpec(renderer) &&
        (renderer.format === "enumOption" || renderer.format === "i18nText")
      ) {
        return renderer;
      }
    }
  }
  return undefined;
}

export function resolveHeaderStatusText(
  screen: ProjectionDetailScreenDefinition,
  record: Readonly<Record<string, unknown>>,
  translate: Translate,
): string {
  const statusField = screen.header?.status;
  // skip: a header without status has no badge text
  if (statusField === undefined) return "";
  const raw = record[statusField];
  const rawText = String(raw ?? "");
  const format = screen.header?.statusFormat ?? layoutStatusFormat(screen, statusField);
  if (format === undefined) return rawText;
  const formatted = applyFormatSpec(format, raw, translate);
  return formatted === "" ? rawText : formatted;
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
