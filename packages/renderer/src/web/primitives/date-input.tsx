// DateInput (kind:"date") — the typeable date input lives in DateField,
// so `date` and `timestamp` share the same typing/calendar UX.
// This file only provides the public mapping; the logic is in
// date-field.tsx, and the date parsing utilities are in date-parse.ts.

export { DateField as DateInput, type DateFieldProps as DateInputProps } from "./date-field.tsx";
