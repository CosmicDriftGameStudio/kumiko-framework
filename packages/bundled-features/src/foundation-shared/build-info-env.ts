import * as z from "zod";

/** `BUILD_VERSION`/`BUILD_TIME`, passed from the Dockerfile build args and
 *  served by the health and version routes ("dev"/"unknown" when unset). */
export const buildInfoEnvSchema = z.object({
  BUILD_VERSION: z
    .string()
    .min(1)
    .optional()
    .describe("Release version baked into the image (git tag or sha). Default: dev."),
  BUILD_TIME: z
    .string()
    .min(1)
    .optional()
    .describe("Image build timestamp (ISO 8601). Default: unknown."),
});
