import type { EntityEventMigration } from "@cosmicdrift/kumiko-types/fields";
import type { SignatureLegacyHostResolver } from "./options.ts";

// Always registered (a no-op without a resolver) so every executor and the mounted entity stamp the same event version.
export function createRequestHostUpcast(
  legacyHostOf: SignatureLegacyHostResolver | undefined,
  hostEntities: readonly string[],
): EntityEventMigration {
  return {
    fromVersion: 1,
    toVersion: 2,
    transform: async (fields, ctx) => {
      const { hostType, subjectType, subjectId } = fields;
      if (legacyHostOf === undefined || hostType != null) return fields;
      if (typeof subjectType !== "string" || typeof subjectId !== "string") return fields;
      const host = await legacyHostOf({ subjectType, subjectId }, ctx);
      if (host === undefined || !hostEntities.includes(host.hostType) || host.hostId === "") {
        return fields;
      }
      return { ...fields, hostType: host.hostType, hostId: host.hostId };
    },
  };
}
