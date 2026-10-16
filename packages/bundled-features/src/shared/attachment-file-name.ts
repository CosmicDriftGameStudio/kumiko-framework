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
