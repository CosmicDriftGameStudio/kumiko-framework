// Public API of the pattern-library — Designer (C5/C6), AI-Builder (L2),
// MCP-Server (L9) consume from here.

export { getPatternSchema, groupByCategory, PATTERN_LIBRARY } from "./library";
export type {
  BooleanField,
  CodeBlockField,
  DiscriminatedUnionField,
  EntityFieldsEditorField,
  EntityRefField,
  FormFieldLabel,
  FormFieldSpec,
  FormInputType,
  JsonReadonlyField,
  KeyValueMapField,
  NumberField,
  PatternCategory,
  PatternFormSchema,
  SelectField,
  SelectOption,
  StringListField,
  TextareaField,
  TextField,
} from "./types";
