import { defineEntityListHandler } from "@cosmicdrift/kumiko-framework/engine";
import { waitlistEntryEntity } from "../entity.js";
import { adminAccess } from "../lib.js";

// Entity-convention list: the QN waitlist:query:waitlist-entry:list is what the
// entityList screen resolves; paging, search and sort come from the entity flags.
export const listQuery = defineEntityListHandler("waitlistEntry", waitlistEntryEntity, {
  access: adminAccess,
  agent: { risk: "high" },
  description:
    "Lists waitlist entries for the admin screen with paging, search over name, email and company, and sorting; carries the entrants' personal data.",
});
