import { CONTACT_SUBJECT_MAX_CHARS } from "./web/constants.ts";

// The website form has no subject field; the first non-empty line of the message stands in for it.
export function deriveSubjectFromMessage(message: string): string {
  const firstLine = message.split(/[\r\n]/).find((line) => line.trim() !== "") ?? "";
  const trimmed = firstLine.trim();
  const chars = [...trimmed];
  if (chars.length <= CONTACT_SUBJECT_MAX_CHARS) return trimmed;
  return `${chars
    .slice(0, CONTACT_SUBJECT_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}
