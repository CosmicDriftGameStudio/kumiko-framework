import type {
  EditFieldSpec,
  EntityEditScreenDefinition,
  SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  isFieldsEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";

// Normalized field specs actually rendered by the screen's layout, extension
// (and relatedList) sections skipped. Both this and `layoutFieldNames` key
// off "rendered by the layout" for the same reason: a field the user never
// sees gets no chance to review/correct a value nor to fix a presence error
// (search-param merge, #1708; presence schema in form-schema.ts).
export function layoutEditFields(
  screen: EntityEditScreenDefinition,
): readonly Exclude<EditFieldSpec, string>[] {
  const specs: Exclude<EditFieldSpec, string>[] = [];
  for (const section of screen.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section)) {
      specs.push(normalizeEditField(spec));
    }
  }
  return specs;
}

export function layoutFieldNames(screen: EntityEditScreenDefinition): ReadonlySet<string> {
  return new Set(layoutEditFields(screen).map((spec) => spec.field));
}

function isRequiredField(field: SecretMintScreenDefinition["fields"][string] | undefined): boolean {
  return field !== undefined && "required" in field && field.required === true;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

// A layout-hidden field can never be edited, so a required one without a seeded
// value would leave the form permanently unsubmittable.
export function hiddenRequiredFieldsFilled(
  screen: EntityEditScreenDefinition,
  fields: SecretMintScreenDefinition["fields"],
  initial: Readonly<Record<string, unknown>>,
): boolean {
  return layoutEditFields(screen).every(
    (spec) =>
      spec.visible !== false ||
      !isRequiredField(fields[spec.field]) ||
      hasValue(initial[spec.field]),
  );
}
