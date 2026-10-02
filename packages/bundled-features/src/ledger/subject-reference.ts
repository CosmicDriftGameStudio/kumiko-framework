// Subject columns are nullable; anything that is not a string reads as unset.
export function readSubjectReference(row: Record<string, unknown>): {
  subjectType: string | null;
  subjectId: string | null;
} {
  return {
    subjectType: typeof row["subjectType"] === "string" ? row["subjectType"] : null,
    subjectId: typeof row["subjectId"] === "string" ? row["subjectId"] : null,
  };
}
