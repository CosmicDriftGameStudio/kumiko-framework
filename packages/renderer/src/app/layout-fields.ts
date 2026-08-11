import type {
  EditFieldSpec,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isExtensionEditSection, normalizeEditField } from "@cosmicdrift/kumiko-framework/ui-types";

// Normalized field specs actually rendered by the screen's layout, extension
// sections skipped. Both this and `layoutFieldNames` key off "rendered by
// the layout" for the same reason: a field the user never sees gets no
// chance to review/correct a value nor to fix a presence error
// (search-param merge, #1708; presence schema in form-schema.ts).
export function layoutEditFields(
  screen: EntityEditScreenDefinition,
): readonly Exclude<EditFieldSpec, string>[] {
  const specs: Exclude<EditFieldSpec, string>[] = [];
  for (const section of screen.layout.sections) {
    if (isExtensionEditSection(section)) continue;
    for (const spec of section.fields) {
      specs.push(normalizeEditField(spec));
    }
  }
  return specs;
}

export function layoutFieldNames(screen: EntityEditScreenDefinition): ReadonlySet<string> {
  return new Set(layoutEditFields(screen).map((spec) => spec.field));
}
