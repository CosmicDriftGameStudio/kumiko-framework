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
import { type StatusBadgeOptionTone, statusToneForOption } from "../primitives.tsx";
import { isAbsoluteHttpUrl, withUiLocale } from "./projection-detail-navigation.ts";

export function headerStatusTone(
  header: NonNullable<ProjectionDetailScreenDefinition["header"]>,
  record: Readonly<Record<string, unknown>>,
): StatusBadgeOptionTone | undefined {
  // skip: a header without status has no tone
  if (header.status === undefined) return undefined;
  const value = String(record[header.statusToneField ?? header.status] ?? "");
  return statusToneForOption(value, header.statusTones);
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

export function headerSecondaryStatusTone(
  header: NonNullable<ProjectionDetailScreenDefinition["header"]>,
  record: Readonly<Record<string, unknown>>,
): StatusBadgeOptionTone | undefined {
  // skip: a header without secondaryStatus has no second badge
  if (header.secondaryStatus === undefined) return undefined;
  return statusToneForOption(String(record[header.secondaryStatus] ?? ""), header.statusTones);
}

function resolveStatusFieldText(
  screen: ProjectionDetailScreenDefinition,
  record: Readonly<Record<string, unknown>>,
  translate: Translate,
  statusField: string | undefined,
  explicitFormat: FormatSpec | undefined,
): string {
  // skip: no field, no badge text
  if (statusField === undefined) return "";
  const format = explicitFormat ?? layoutStatusFormat(screen, statusField);
  return formatOrRaw(format, record[statusField], translate);
}

export function resolveHeaderStatusText(
  screen: ProjectionDetailScreenDefinition,
  record: Readonly<Record<string, unknown>>,
  translate: Translate,
): string {
  return resolveStatusFieldText(
    screen,
    record,
    translate,
    screen.header?.status,
    screen.header?.statusFormat,
  );
}

export function resolveHeaderSecondaryStatusText(
  screen: ProjectionDetailScreenDefinition,
  record: Readonly<Record<string, unknown>>,
  translate: Translate,
): string {
  return resolveStatusFieldText(
    screen,
    record,
    translate,
    screen.header?.secondaryStatus,
    undefined,
  );
}

export function formatOrRaw(
  format: FormatSpec | undefined,
  raw: unknown,
  translate: Translate,
  uiLocale?: string,
): string {
  const rawText = String(raw ?? "");
  if (format === undefined) return rawText;
  const formatted = applyFormatSpec(
    uiLocale === undefined ? format : withUiLocale(format, uiLocale),
    raw,
    translate,
  );
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
  queryCounts: Readonly<Record<string, number>> = {},
): DetailTabItem[] {
  // Adjacent sections sharing an id are one tab; its label and count come from the first.
  return sections
    .filter((section, index) => section.id !== sections[index - 1]?.id)
    .map((section) => {
      const countField =
        isWriteFormEditSection(section) || section.kind === "stepList"
          ? undefined
          : section.countField;
      const countValue =
        countField !== undefined ? record[countField] : queryCounts[section.id ?? ""];
      const count =
        typeof countValue === "number" && Number.isFinite(countValue) ? countValue : undefined;
      return {
        id: section.id ?? "",
        label: translate(
          sections.find((s) => s.id === section.id && s.tabLabel !== undefined)?.tabLabel ??
            section.title ??
            section.id ??
            "",
        ),
        ...(count !== undefined && { count }),
      };
    });
}
