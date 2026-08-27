import { z } from "zod";

/** Accept string[] or a JSON-encoded string[]; reject bare non-JSON strings. */
export const rolesInputSchema = z.union([
  z.array(z.string()),
  // Legacy wire form: JSON-encoded string[]. Bare "SystemAdmin" used to
  // parseRoles → [] and silently wipe/clear roles — reject that at the boundary.
  z.string().transform((raw, ctx) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed as string[];
      }
    } catch {
      /* fall through */
    }
    ctx.addIssue({ code: "custom", message: "roles must be a string[] or JSON string array" });
    return z.NEVER;
  }),
]);
