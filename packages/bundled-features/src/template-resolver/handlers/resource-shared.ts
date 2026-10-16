import * as z from "zod";
import { isDocumentResourceKey } from "../document-schema.js";

export const RESOURCE_MAX_BYTES_CONFIG_KEY = "template-resolver:config:resource-max-bytes";
export const DEFAULT_RESOURCE_MAX_BYTES = 2 * 1024 * 1024;

export const resourceKeySchema = z.string().min(1).max(64).refine(isDocumentResourceKey, {
  message: "resource key must be letters, digits, dot, dash or underscore",
});

export const RESOURCE_PURPOSES = ["image", "attachment"] as const;
export type ResourcePurpose = (typeof RESOURCE_PURPOSES)[number];

export const MAX_FILE_ATTACHMENTS_PER_TEMPLATE = 10;
