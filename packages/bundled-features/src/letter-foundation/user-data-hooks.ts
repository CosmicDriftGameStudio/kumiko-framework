import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_ENTITY } from "./constants.ts";
import { letterTable } from "./entity.ts";

// Only the user's own part of a letter: the recipient fields belong to the recipient, not to the staff member.
export const letterExportHook: UserDataExportHook = async (ctx) => {
  const created = await ctx.db.selectMany(letterTable, { createdBy: ctx.userId });
  const approved = await ctx.db.selectMany(letterTable, { approvedBy: ctx.userId });
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of [...created, ...approved]) byId.set(String(row["id"]), row);
  if (byId.size === 0) return null;
  return {
    entity: LETTER_ENTITY,
    rows: [...byId.values()].map((row) => ({
      id: row["id"],
      status: row["status"],
      shippingMode: row["shippingMode"],
      sourceEntityType: row["sourceEntityType"],
      sourceEntityId: row["sourceEntityId"],
      createdBy: row["createdBy"],
      approvedBy: row["approvedBy"],
      approvedAt: row["approvedAt"],
      sentAt: row["sentAt"],
    })),
  };
};

export const letterDeleteHook: UserDataDeleteHook = async () => {
  // Deliberate no-op: the letter is a business record kept for its retention period; createdBy and
  // approvedBy hold only the user id, a pseudonymous reference that stops identifying anyone once the user row is anonymized.
};
