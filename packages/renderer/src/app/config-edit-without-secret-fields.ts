import type {
  ConfigEditScreenDefinition,
  EditFieldSpec,
  EditSectionSpec,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isFieldsEditSection, normalizeEditField } from "@cosmicdrift/kumiko-framework/ui-types";

// A merged provider form carries the secret-backed fields of a secrets feature the viewer may
// not read. Without the secrets list those fields cannot show or save a state, so the form
// drops them and stays usable for the config keys.
export function configEditWithoutSecretFields(
  screen: ConfigEditScreenDefinition,
): ConfigEditScreenDefinition {
  const secretFieldNames = new Set(Object.keys(screen.secretKeys ?? {}));
  if (secretFieldNames.size === 0) return screen;

  const keepSpec = (spec: EditFieldSpec): boolean =>
    !secretFieldNames.has(normalizeEditField(spec).field);
  const fields = Object.fromEntries(
    Object.entries(screen.fields).filter(([name]) => !secretFieldNames.has(name)),
  );
  const sections = screen.layout.sections.flatMap((section): EditSectionSpec[] => {
    if (!isFieldsEditSection(section)) return [section];
    if ("groups" in section) {
      const groups = section.groups
        .map((group) => ({ ...group, fields: group.fields.filter(keepSpec) }))
        .filter((group) => group.fields.length > 0);
      return groups.length === 0 ? [] : [{ ...section, groups }];
    }
    const kept = section.fields.filter(keepSpec);
    return kept.length === 0 ? [] : [{ ...section, fields: kept }];
  });
  return {
    ...screen,
    fields,
    layout: { ...screen.layout, sections },
  };
}
