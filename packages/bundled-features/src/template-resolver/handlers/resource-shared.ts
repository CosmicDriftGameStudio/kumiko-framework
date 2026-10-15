import * as z from "zod";
import { isDocumentResourceKey } from "../document-schema.js";

export const RESOURCE_MAX_BYTES_CONFIG_KEY = "template-resolver:config:resource-max-bytes";
export const DEFAULT_RESOURCE_MAX_BYTES = 2 * 1024 * 1024;

export const resourceKeySchema = z.string().min(1).max(64).refine(isDocumentResourceKey, {
  message: "resource key must be letters, digits, dot, dash or underscore",
});

export function parseLinkedResources(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
