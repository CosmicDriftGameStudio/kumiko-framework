# Inspection checklist

An embedded list as a phone inspection checklist: the inspector walks fixed rows,
enters a measurement or a result, and documents deviations with a finding and photos.

## What it shows

- **Conditional cells** (`src/entities/inspection-protocol.ts`): `visibleWhen` and
  `requiredWhen` on sub-fields and on top-level fields. The server enforces
  `requiredWhen` on create and update and answers with one `required` path per
  missing cell (`checkpoints.0.finding`, `condition`).
- **Pass/fail by range**: the derived `inRange` cell turns `measured`, `min` and `max`
  into `ok` or `not_ok` (bounds included). The server recomputes it, so a client-sent
  result never survives a value outside the range. `when` limits it to measurement rows;
  a check row keeps the result the inspector picked.
- **Photos per row**: an `images` sub-field. Upload with `entityType`, `fieldName` of the
  embedded list and `subField` of the photo cell; files are bound, tenant-checked and
  disposed like a top-level images field, always under the embedded list's field name.
- **Fixed rows**: `inspection-protocol:create-from-plan` copies label, kind and limits from
  a plan; the edit screen keeps those cells read-only and the row count fixed. It sets
  `layout.width: "full"` because the default form width pushes result, finding and photos
  behind horizontal scroll.

## Source

`src/feature.ts` wires the two entities, the handler and the screen. The integration test
covers every behavior above over real HTTP.
