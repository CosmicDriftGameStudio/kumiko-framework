// DateInput (kind:"date") — die tippbare Datums-Eingabe lebt in DateField,
// damit `date` und `timestamp` dieselbe Tipp-/Kalender-UX teilen (#369).
// Diese Datei hält nur das öffentliche Mapping; die Logik ist in
// date-field.tsx, die Date-Parse-Utils in date-parse.ts.

export { DateField as DateInput, type DateFieldProps as DateInputProps } from "./date-field";
