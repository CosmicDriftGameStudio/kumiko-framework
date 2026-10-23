import { fileUrl } from "./file-name.ts";
import { buildMeta, systemLabelMap, variableLabelMap } from "./mail-draft.ts";
import type { EditorVocabulary } from "./mail-edit-center.tsx";
import type {
  LinkedResourceView,
  MailDraft,
  MailValidation,
  PickedValues,
  TemplateRowView,
} from "./mail-types.ts";

// The editor replaces this token with the decoded image size once the preview image loaded.
const SIZE_TOKEN = "{size}";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export type MailEditorBodyProps = {
  readonly slug: string;
  readonly locale: string;
  readonly locales: readonly string[];
  readonly title: string;
  readonly isSystemAdmin: boolean;
  readonly row: TemplateRowView | null;
  readonly systemVersion: number | null;
  readonly fallbackLocale: string | null;
  readonly onLocaleChange: (locale: string) => void;
  readonly onReload: () => Promise<void>;
  readonly onRefreshRow: () => Promise<void>;
};

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function placeholderNames(validation: MailValidation | null): string[] {
  if (validation === null) return [];
  const own = Object.entries(validation.variables).flatMap(([name, variable]) => [
    name,
    ...Object.keys(variable.item ?? {}).map((item) => `${name}.${item}`),
  ]);
  return uniqueValues([...own, ...validation.systemPlaceholders]);
}

export function mailSaveFlags(input: {
  readonly locked: boolean;
  readonly busy: boolean;
  readonly validation: MailValidation | null;
  readonly dirty: boolean;
  readonly creating: boolean;
  readonly row: TemplateRowView | null;
}): { readonly canSave: boolean; readonly canPublish: boolean } {
  const { locked, busy, validation, dirty, creating, row } = input;
  return {
    canSave: !locked && !busy && validation?.canSave === true && (dirty || creating),
    canPublish:
      !locked &&
      !busy &&
      validation?.canPublish === true &&
      (dirty || creating || row?.status !== "active"),
  };
}

export function resourcePreviewsOfMail(resources: readonly LinkedResourceView[], t: Translate) {
  return Object.fromEntries(
    resources.flatMap((resource) =>
      resource.kind === "image"
        ? [
            [
              resource.key,
              {
                src: fileUrl(resource.fileRefId),
                caption: t("documentDesigner.mail.resource.caption", {
                  key: resource.key,
                  size: SIZE_TOKEN,
                }),
              },
            ],
          ]
        : [],
    ),
  );
}

// Nothing is written yet in a missing language, so no placeholder may read as missing.
export function railValidationOf(locked: boolean, validation: MailValidation | null) {
  return locked && validation != null
    ? { ...validation, missingRequired: [] }
    : (validation ?? null);
}

export function vocabularyOf(t: Translate, validation: MailValidation | null): EditorVocabulary {
  return {
    names: placeholderNames(validation ?? null),
    labels: {
      ...systemLabelMap(t, validation?.systemPlaceholders ?? []),
      ...variableLabelMap(t, validation?.variables ?? {}),
    },
    system: validation?.systemPlaceholders ?? [],
  };
}

export function testMailPayload(input: {
  readonly slug: string;
  readonly locale: string;
  readonly draft: MailDraft;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly includeAttachments: boolean;
  readonly prefixSubject: boolean;
  readonly pickedVariables: PickedValues | null;
}) {
  return {
    slug: input.slug,
    locale: input.locale,
    content: input.draft.body,
    meta: buildMeta(input.draft),
    variableSchema: input.variableSchema,
    includeAttachments: input.includeAttachments,
    prefixSubject: input.prefixSubject,
    ...(input.pickedVariables !== null && { variables: input.pickedVariables }),
  };
}

export function previewPayload(input: {
  readonly slug: string;
  readonly locale: string;
  readonly settled: MailDraft;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly pickedVariables: PickedValues | null;
}) {
  return {
    slug: input.slug,
    kind: "mail" as const,
    locale: input.locale,
    content: input.settled.body,
    meta: buildMeta(input.settled),
    variableSchema: input.variableSchema,
    ...(input.pickedVariables !== null && { variables: input.pickedVariables }),
  };
}
