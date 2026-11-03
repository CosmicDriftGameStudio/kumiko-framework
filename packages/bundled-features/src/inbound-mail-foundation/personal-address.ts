import * as z from "zod";
import { decryptStoredUserEmail } from "../shared/index.ts";

const userRowSchema = z.object({
  email: z.string().optional(),
  isDeleted: z.boolean().nullish(),
});

// A personal mailbox may only carry the caller's own login address: the login check of a password
// IMAP server (or the OAuth consent) does not bind the address, so a free choice would let a member
// claim info@firma.de. `userRow` is the user:find-for-auth row of the session user, never payload data.
export async function isOwnLoginAddress(userRow: unknown, address: string): Promise<boolean> {
  const row = userRowSchema.safeParse(userRow);
  if (!row.success || !row.data.email || row.data.isDeleted === true) return false;
  const own = await decryptStoredUserEmail(
    row.data.email,
    "inbound-mail-foundation:personal-address",
  );
  return own !== null && own.trim().toLowerCase() === address.trim().toLowerCase();
}
