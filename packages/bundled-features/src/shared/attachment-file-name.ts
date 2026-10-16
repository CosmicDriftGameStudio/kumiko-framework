import * as z from "zod";

const MAX_FILE_NAME_LENGTH = 255;

function hasControlCharacter(value: string): boolean {
  return value.split("").some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export const attachmentFileNameSchema = z
  .string()
  .min(1)
  .max(MAX_FILE_NAME_LENGTH)
  .refine((name) => !name.includes("/") && !name.includes("\\") && !hasControlCharacter(name), {
    message: "file name must not contain path separators or control characters",
  });

const PDF_FILE_NAME_MAX_LENGTH = 200;
const PDF_EXTENSION = ".pdf";

// Shared by everything that names a rendered PDF, so a mail attachment and a download of the same
// template get the same name. The cut leaves room for the extension: the attachment schema caps
// rendered-pdf names, and a name that only fits without ".pdf" would fail it.
export function sanitizePdfAttachmentFileName(raw: string, templateSlug: string): string {
  const cleaned = raw
    .split("")
    .filter((char) => !hasControlCharacter(char))
    .join("")
    .replace(/[/\\";]/g, "-")
    .replaceAll("..", "-")
    .trim()
    .slice(0, PDF_FILE_NAME_MAX_LENGTH - PDF_EXTENSION.length)
    .trim();
  const lastSegment = templateSlug.split(":").pop() ?? templateSlug;
  if (cleaned === "") return `${lastSegment}${PDF_EXTENSION}`;
  return cleaned.toLowerCase().endsWith(PDF_EXTENSION) ? cleaned : `${cleaned}${PDF_EXTENSION}`;
}
